import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from '../components/AppShell'
import { InventoryPage } from '../routes/InventoryPage'
import { MyBidsPage } from '../routes/MyBidsPage'
import { NotFoundPage } from '../routes/NotFoundPage'
import { VehicleDetailPage } from '../routes/VehicleDetailPage'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <InventoryPage /> },
      { path: 'vehicles/:vehicleId', element: <VehicleDetailPage /> },
      { path: 'my-bids', element: <MyBidsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
