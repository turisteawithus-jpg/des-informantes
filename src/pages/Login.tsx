import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogIn, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/rest/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Confirma que la sesion quedo guardada en el navegador antes de salir
        try {
          const me = await fetch("/api/rest/me", { credentials: "include" });
          if (me.ok) {
            // Recarga completa para que toda la app tome la sesion nueva de una vez
            window.location.href = "/dashboard";
            return;
          }
          setError("El servidor te reconocio, pero el navegador no guardo la sesion. Revisa que no estes en modo incognito o con las cookies bloqueadas e intenta de nuevo.");
        } catch {
          setError("La sesion no pudo confirmarse. Intenta de nuevo.");
        }
        setLoading(false);
        return;
      }
      if (res.status === 403) {
        // Correo sin verificar: lo enviamos a pantalla de verificacion
        navigate(`/verify?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(data.error || "Correo o contrasena incorrectos.");
    } catch {
      setError("Error de conexion. Intenta de nuevo.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-2 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl di-gradient flex items-center justify-center mb-2"><LogIn className="h-7 w-7 text-white" /></div>
            <CardTitle className="font-display text-2xl">Entrar a DES Informantes</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-1.5">
                <Label>Correo electrónico</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" required autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Contraseña</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tu contrasena"
                    required
                    className="pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showPassword ? "Ocultar contrasena" : "Ver contrasena"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando…</> : "Entrar"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">¿No tienes cuenta? <Link to="/register" className="text-primary font-medium hover:underline">Regístrate</Link></p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
