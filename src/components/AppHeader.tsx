import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { ChatWidget } from "@/components/ChatWidget";
import { LogOut, Shield, LayoutDashboard, Newspaper, MessageCircle } from "lucide-react";

export function AppHeader() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="di-gradient shadow-lg sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-white" />
            <div className="leading-tight">
              <span className="font-display text-xl text-white tracking-wide block">DES Informantes</span>
              <span className="text-[10px] text-white/70 uppercase tracking-wider">Más allá del relato, están los hechos.</span>
            </div>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
            {isAuthenticated ? (
              <>
                <Button variant="ghost" className="text-white/90 hover:bg-white/10 hover:text-white" onClick={() => navigate("/dashboard")}>
                  <LayoutDashboard className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Mis mesas</span>
                </Button>
                <Button variant="ghost" className="text-white/90 hover:bg-white/10 hover:text-white" onClick={() => navigate("/conversations")}>
                  <MessageCircle className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Chats</span>
                </Button>
                {isAdmin && (
                  <Button variant="ghost" className="text-white/90 hover:bg-white/10 hover:text-white" onClick={() => navigate("/admin")}>
                    <Shield className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Admin</span>
                  </Button>
                )}
                <span className="hidden sm:inline text-white/80 text-sm px-2">{user?.username}</span>
                <Button variant="ghost" size="icon" className="text-white/90 hover:bg-white/10 hover:text-white" onClick={logout} title="Cerrar sesión">
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="text-white/90 hover:bg-white/10 hover:text-white" onClick={() => navigate("/login")}>Entrar</Button>
                <Button className="bg-white text-[#0a2540] hover:bg-gray-100 font-semibold" onClick={() => navigate("/register")}><span className="hidden sm:inline">Crear cuenta</span><span className="sm:hidden">Crear</span></Button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Chats personales: ventana flotante disponible en toda la plataforma */}
      <ChatWidget />
    </>
  );
}
