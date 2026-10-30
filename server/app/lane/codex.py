"""A client for `codex app-server`: Codex's JSON-RPC interface over stdio.

This is how Lane uses the buyer's ChatGPT plan, the same route OpenClaw takes: Codex holds the
ChatGPT sign-in (it opens the browser login, stores and refreshes the tokens), and we only ever
see its replies. Messages are one JSON object per line, JSON-RPC 2.0 without the "jsonrpc" field.

Three kinds of message arrive: responses to our requests (matched by id), notifications (routed
to whoever subscribed to that thread, or to the account listeners), and requests from the server
(a tool call, an approval prompt), which a handler must answer.
"""

import asyncio
import contextlib
import json
import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Codex features that would give the model tools beyond Lane's own: a shell, file edits, the web,
# plugins, other agents. With these off, a read-only sandbox and an empty working directory,
# Lane's tools are the only way it can learn anything. The bridge still refuses any other tool
# that shows up (see agent.py), in case a Codex update adds one.
DISABLED_FEATURES = (
    "apps",
    "browser_use",
    "browser_use_external",
    "computer_use",
    "goals",
    "hooks",
    "image_generation",
    "in_app_browser",
    "multi_agent",
    "plugins",
    "remote_plugin",
    "shell_snapshot",
    "shell_tool",
    "skill_search",
    "sleep_tool",
    "tool_suggest",
    "unified_exec",
    "view_image",
    "workspace_dependencies",
    "worktrees",
)
CONFIG_OVERRIDES = ('web_search="disabled"', "mcp_servers={}")

REQUEST_TIMEOUT_SECONDS = 30.0
# Large enough for a model list or a long reply in one line.
_LINE_LIMIT = 16 * 1024 * 1024

ServerRequestHandler = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


class CodexError(Exception):
    """Codex is missing, crashed, or answered a request with an error."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


class CodexClient:
    """One running `codex app-server`, started on first use and restarted if it dies."""

    def __init__(self, command: Sequence[str], home: Path, client_version: str) -> None:
        self._command = list(command)
        self._home = home
        self._client_version = client_version
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._start_lock = asyncio.Lock()
        self._next_id = 0
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._threads: dict[str, asyncio.Queue[tuple[str, dict[str, Any]]]] = {}
        self._account_listeners: list[Callable[[str, dict[str, Any]], None]] = []
        self.handle_server_request: ServerRequestHandler | None = None
        self._answering: set[asyncio.Task[None]] = set()  # keeps running answers referenced
        self.user_agent: str | None = None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def ensure_started(self) -> None:
        async with self._start_lock:
            if self.running:
                return
            await self._spawn()
            try:
                result = await self.request(
                    "initialize",
                    {
                        "clientInfo": {
                            "name": "the_block_lane",
                            "title": "The Block",
                            "version": self._client_version,
                        },
                        # Lane's own tools (dynamicTools) are an experimental API.
                        "capabilities": {"experimentalApi": True},
                    },
                )
            except CodexError:
                await self.close()
                raise
            self.user_agent = str(result.get("userAgent", ""))
            self._send({"method": "initialized"})

    async def _spawn(self) -> None:
        self._home.mkdir(parents=True, exist_ok=True)
        args = [*self._command, "app-server"]
        for override in CONFIG_OVERRIDES:
            args += ["-c", override]
        for feature in DISABLED_FEATURES:
            args += ["--disable", feature]
        try:
            self._process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env={**os.environ, "CODEX_HOME": str(self._home)},
                limit=_LINE_LIMIT,
            )
        except (FileNotFoundError, PermissionError) as exc:
            raise CodexError(f"Can't start Codex ({self._command[0]}): {exc}") from exc
        self._reader = asyncio.create_task(self._read(self._process))

    async def close(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 5)
            except TimeoutError:
                process.kill()
                await process.wait()
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
            self._reader = None
        self._fail_pending("Codex stopped.")

    async def request(
        self, method: str, params: dict[str, Any], timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> dict[str, Any]:
        if not self.running:
            raise CodexError("Codex isn't running.")
        self._next_id += 1
        request_id = self._next_id
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        self._send({"id": request_id, "method": method, "params": params})
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError as exc:
            raise CodexError(f"Codex didn't answer {method} in time.") from exc
        finally:
            self._pending.pop(request_id, None)

    @contextlib.asynccontextmanager
    async def thread_events(
        self, thread_id: str
    ) -> AsyncIterator[asyncio.Queue[tuple[str, dict[str, Any]]]]:
        """Notifications for one thread, as (method, params), for as long as the block runs."""
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
        self._threads[thread_id] = queue
        try:
            yield queue
        finally:
            if self._threads.get(thread_id) is queue:
                del self._threads[thread_id]

    def on_account_event(self, listener: Callable[[str, dict[str, Any]], None]) -> None:
        self._account_listeners.append(listener)

    def _send(self, message: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise CodexError("Codex isn't running.")
        process.stdin.write((json.dumps(message) + "\n").encode())

    def _fail_pending(self, reason: str) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(CodexError(reason))
        self._pending.clear()
        # Wake every open turn so it can report the failure instead of waiting forever.
        for queue in self._threads.values():
            queue.put_nowait(("lane/disconnected", {}))

    async def _read(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        try:
            while line := await process.stdout.readline():
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Ignoring a line from Codex that isn't JSON")
                    continue
                self._dispatch(message)
        finally:
            if self._process is process:
                self._process = None
            self._fail_pending("Codex stopped unexpectedly.")

    def _dispatch(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method is None:  # a response
            future = self._pending.get(message.get("id", -1))
            if future is None or future.done():
                return
            if "error" in message:
                error = message["error"] or {}
                future.set_exception(CodexError(str(error.get("message")), error.get("code")))
            else:
                future.set_result(message.get("result") or {})
        elif "id" in message:  # a request from the server: answer it off the read loop
            task = asyncio.create_task(
                self._answer(message["id"], method, message.get("params") or {})
            )
            self._answering.add(task)
            task.add_done_callback(self._answering.discard)
        else:
            params = message.get("params") or {}
            if method.startswith("account/"):
                for listener in self._account_listeners:
                    listener(method, params)
            thread_id = params.get("threadId")
            if isinstance(thread_id, str) and thread_id in self._threads:
                self._threads[thread_id].put_nowait((method, params))

    async def _answer(self, request_id: Any, method: str, params: dict[str, Any]) -> None:
        handler = self.handle_server_request
        try:
            if handler is None:
                raise CodexError(f"{method} isn't supported.")
            result = await handler(method, params)
        except Exception as exc:
            logger.info("Declined Codex request %s: %s", method, exc)
            with contextlib.suppress(CodexError):
                self._send({"id": request_id, "error": {"code": -32601, "message": str(exc)}})
            return
        with contextlib.suppress(CodexError):
            self._send({"id": request_id, "result": result})
