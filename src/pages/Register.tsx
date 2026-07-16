import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { Loader2, MailCheck } from "lucide-react";

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const register = trpc.auth.register.useMutation({
    onSuccess: () => navigate(`/verify?email=${encodeURIComponent(email)}`),
    onError: (e) => setError(e.message),
  });

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
            <p className="text-sm text-muted-foreground">Te enviaremos un código de verificación a tu correo.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(""); register.mutate({ email, username, password }); }}>
              <div className="space-y-1.5"><Label>Nombre de usuario</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Cómo te verán en las mesas" required /></div>
              <div className="space-y-1.5"><Label>Correo electrónico</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" required /></div>
              <div className="space-y-1.5"><Label>Contraseña</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" required minLength={8} /></div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={register.isPending}>
                {register.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando código…</> : "Registrarme"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">¿Ya tienes cuenta? <Link to="/login" className="text-primary font-medium hover:underline">Entra aquí</Link></p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
