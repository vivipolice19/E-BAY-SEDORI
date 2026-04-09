import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Search,
  ShoppingCart,
  Bookmark,
  Settings,
  TrendingUp,
  ArrowLeftRight,
  FileSpreadsheet,
  PackageCheck,
} from "lucide-react";

const menuItems = [
  {
    group: "メイン",
    items: [
      { title: "ダッシュボード", url: "/", icon: LayoutDashboard },
      { title: "eBay検索", url: "/search", icon: Search },
      { title: "手動リサーチ", url: "/research", icon: ShoppingCart },
      { title: "保存リスト", url: "/watchlist", icon: Bookmark },
      { title: "出品管理", url: "/listing", icon: PackageCheck },
    ],
  },
  {
    group: "ツール",
    items: [
      { title: "利益計算機", url: "/calculator", icon: ArrowLeftRight },
      { title: "Sheets同期", url: "/sheets", icon: FileSpreadsheet },
      { title: "設定", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight text-sidebar-foreground">せどりツール</p>
            <p className="text-xs text-muted-foreground leading-tight">eBay仕入れ支援</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {menuItems.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={item.url} data-testid={`nav-${item.title}`}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-xs text-muted-foreground text-center">
          スプレッドシートID連携済み
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
