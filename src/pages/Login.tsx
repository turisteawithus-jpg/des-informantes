import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { Loader2, LogIn } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const login = trpc.auth.login.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); navigate("/dashboard"); },
    onError: (e) => {
      if (e.data?.code === "PRECONDITION_FAILED") { navigate(`/verify?email=${encodeURIComponent(email)}`); return; }
      setError(e.message);
    },
  });

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
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(""); login.mutate({ email, password }); }}>
              <div className="space-y-1.5"><Label>Correo electrónico</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div className="space-y-1.5"><Label>Contraseña</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={login.isPending}>{login.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando…</> : "Entrar"}</Button>
              <p className="text-sm text-center text-muted-foreground">¿No tienes cuenta? <Link to="/register" className="text-primary font-medium hover:underline">Regístrate</Link></p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
