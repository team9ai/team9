import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { useIsDesktop } from "@/hooks/useMediaQuery";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ location }) => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const isDesktop = useIsDesktop();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 主功能导航区 - 最左侧 */}
      {isDesktop && <MainSidebar />}

      {/* 子路由内容（包含 SubSidebar 和 MainContent）*/}
      <Outlet />

      {/* 移动端底部导航栏 */}
      {!isDesktop && <MobileTabBar />}
    </div>
  );
}
