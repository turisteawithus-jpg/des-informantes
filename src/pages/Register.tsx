import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MailCheck, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsDiffer = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden. Revisa que ambas sean iguales.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/rest/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al registrar");
      } else {
        navigate(`/verify?email=${encodeURIComponent(email)}`);
      }
    } catch {
      setError("Error de conexion");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-2 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl di-gradient flex items-center justify-center mb-2">
              <MailCheck className="h-7 w-7 text-white" />
            </div>
            <CardTitle className="font-display text-2xl">Crea tu cuenta en DES Informantes</CardTitle>
            <p className="text-sm text-muted-foreground">Te enviaremos un codigo de verificacion a tu correo.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleRegister}>
              <div className="space-y-1.5"><Label>Nombre de usuario</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Como te veran en las mesas" required /></div>
              <div className="space-y-1.5"><Label>Correo electronico</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" required /></div>
              <div className="space-y-1.5">
                <Label>Contrasena</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimo 8 caracteres"
                    required
                    minLength={8}
                    className="pr-10"
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
              <div className="space-y-1.5">
                <Label>Repite la contrasena</Label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Escribela de nuevo para confirmar"
                    required
                    minLength={8}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showConfirm ? "Ocultar contrasena" : "Ver contrasena"}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordsMatch && (
                  <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Las contrasenas coinciden</p>
                )}
                {passwordsDiffer && (
                  <p className="text-xs text-destructive">Las contrasenas no coinciden todavia.</p>
                )}
              </div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || passwordsDiffer}>
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando codigo...</> : "Registrarme"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">Ya tienes cuenta? <Link to="/login" className="text-primary font-medium hover:underline">Entra aqui</Link></p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
