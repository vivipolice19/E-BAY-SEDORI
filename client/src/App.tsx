import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import EbaySearch from "@/pages/EbaySearch";
import PriceResearch from "@/pages/PriceResearch";
import Watchlist from "@/pages/Watchlist";
import Calculator from "@/pages/Calculator";
import SheetsSync from "@/pages/SheetsSync";
import SettingsPage from "@/pages/Settings";
import ListingPage from "@/pages/Listing";
import { ClientPersistenceBootstrap } from "@/components/ClientPersistenceBootstrap";

const style = {
  "--sidebar-width": "14rem",
  "--sidebar-width-icon": "3.5rem",
};

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/search" component={EbaySearch} />
      <Route path="/research" component={PriceResearch} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/calculator" component={Calculator} />
      <Route path="/sheets" component={SheetsSync} />
      <Route path="/listing" component={ListingPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ClientPersistenceBootstrap />
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full overflow-hidden">
            <AppSidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
              <header className="flex items-center px-4 py-2 border-b border-border bg-background flex-shrink-0 h-12">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
              </header>
              <main className="flex-1 overflow-y-auto">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
