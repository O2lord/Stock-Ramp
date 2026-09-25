// client/components/StockRamp/Admin/AdminDashboard.tsx
// Top-level admin content — mirrors TrustVault/Admin/AdminDashboard.tsx as a
// tabbed container over the other three Admin components. Assumes the
// caller (`app/admin/page.tsx`) has already gated on wallet-connected +
// `useIsAdmin()` + `GlobalState` initialized — this component just renders
// the authenticated admin experience.

"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlobalStats } from "./GlobalStats";
import { AdminSettings } from "./AdminSettings";
import { ValidatorManagement } from "./ValidatorManagement";

export function AdminDashboard() {
  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="validators">Validators</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <GlobalStats />
      </TabsContent>

      <TabsContent value="settings">
        <AdminSettings />
      </TabsContent>

      <TabsContent value="validators">
        <ValidatorManagement />
      </TabsContent>
    </Tabs>
  );
}
