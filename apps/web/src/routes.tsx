import { Navigate, RouteObject } from "react-router-dom";
import { Layout } from "@/components/layout";
import { AdminLayout } from "@/components/AdminLayout";
import { Login } from "@/pages/Login";
import { Chat } from "@/pages/Chat";
import { Dashboard } from "@/pages/Dashboard";
import { SkillMarket } from "@/pages/SkillMarket";
import { PromptMarket } from "@/pages/PromptMarket";
import { SmartReview } from "@/pages/SmartReview";
import { SmartTest } from "@/pages/SmartTest";
import { Settings } from "@/pages/Settings";
import { Requirements } from "@/pages/Requirements";
import { ProjectCode } from "@/pages/ProjectCode";
import { PersonalAssistantPage } from "@/pages/PersonalAssistantPage";
import { PersonalAssistantChat } from "@/pages/PersonalAssistantChat";
import { AdminPage } from "@/pages/AdminPage";

import { Profile } from "@/pages/Profile";

import { AdminDashboard } from "@/pages/AdminDashboard";

export const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  { path: "/profile", element: <Profile /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: "dashboard", element: <AdminDashboard /> },
      { path: "spaces", element: <AdminPage /> },
      { path: "skills", element: <AdminPage /> },
      { path: "prompts", element: <AdminPage /> },
      { path: "config", element: <AdminPage /> },
    ],
  },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },
      { path: "chat", element: <Chat /> },
      { path: "requirements", element: <Requirements /> },
      { path: "code", element: <ProjectCode /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "market/skills", element: <SkillMarket /> },
      { path: "market/prompts", element: <PromptMarket /> },
      { path: "review", element: <SmartReview /> },
      { path: "testing", element: <SmartTest /> },
      { path: "personal-assistant", element: <PersonalAssistantPage /> },
      { path: "personal-assistant/chat/:id", element: <PersonalAssistantChat /> },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
];
