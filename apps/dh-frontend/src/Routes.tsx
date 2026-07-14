import { Navigate, RouteObject } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AdminLayout } from "@/components/AdminLayout";
import { RequireAuth, RequireSuperAdmin, RequireWorkspace, PermissionRoute } from "@/components/RouteGuards";
import { Login } from "@/pages/Login";
import { Chat } from "@/pages/Chat";
import { Dashboard } from "@/pages/Dashboard";
import { SkillMarket } from "@/pages/SkillMarket";
import { PromptMarket } from "@/pages/PromptMarket";
import { SmartReview } from "@/pages/SmartReview";
import { SmartTest } from "@/pages/SmartTest";
import { Settings } from "@/pages/Settings";
import { Requirements } from "@/pages/Requirements";
import { PersonalSpace } from "@/pages/PersonalSpace";
import { PersonalAssistantPage } from "@/pages/PersonalAssistantPage";
import { PersonalAssistantChat } from "@/pages/PersonalAssistantChat";
import { FileView } from "@/pages/FileView";
import { PrdView } from "@/pages/PrdView";
import { ShareDoc } from "@/pages/ShareDoc";
import { AdminPage } from "@/pages/AdminPage";

import { Profile } from "@/pages/Profile";

import { AdminDashboard } from "@/pages/AdminDashboard";

export const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  // 分享文档落地页：免登录访问
  { path: "/s/:token", element: <ShareDoc /> },
  {
    path: "/profile",
    element: <RequireAuth><Profile /></RequireAuth>,
  },
  {
    path: "/file-view",
    element: <RequireAuth><FileView /></RequireAuth>,
  },
  {
    path: "/admin",
    element: <RequireSuperAdmin><AdminLayout /></RequireSuperAdmin>,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: "dashboard", element: <AdminDashboard /> },
      { path: "tenants", element: <AdminPage /> },
      { path: "skills", element: <AdminPage /> },
      { path: "prompts", element: <AdminPage /> },
      { path: "config", element: <AdminPage /> },
    ],
  },
  {
    path: "/",
    element: <RequireWorkspace><Layout /></RequireWorkspace>,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: <Chat /> },
      { path: "requirements", element: <Requirements /> },
      { path: "personal-space", element: <PermissionRoute perm="canViewCode"><PersonalSpace /></PermissionRoute> },
      { path: "code", element: <Navigate to="/personal-space" replace /> },
      { path: "prd", element: <PrdView /> },
      { path: "dashboard", element: <PermissionRoute perm="canViewDashboard"><Dashboard /></PermissionRoute> },
      { path: "market/skills", element: <SkillMarket /> },
      { path: "market/prompts", element: <PromptMarket /> },
      { path: "review", element: <SmartReview /> },
      { path: "testing", element: <SmartTest /> },
      { path: "personal-assistant", element: <PersonalAssistantPage /> },
      { path: "personal-assistant/chat/:id", element: <PersonalAssistantChat /> },
      { path: "settings", element: <PermissionRoute perm="canViewSettings"><Settings /></PermissionRoute> },
      { path: "*", element: <Navigate to="/chat" replace /> },
    ],
  },
];
