import { useState } from "react";
import { useSearchParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound } from "lucide-react";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/rest/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al verificar");
      } else {
        // Recarga completa: la sesion ya quedo creada al verificar
        window.location.href = "/dashboard";
      }
    } catch {
      setError("Error de conexion");
    }
    setVerifying(false);
  }

  async function handleResend() {
    setError("");
    setInfo("");
    setResending(true);
    try {
      const res = await fetch("/api/rest/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al reenviar");
      } else if (data.alreadyVerified) {
        setInfo("Tu correo ya estaba verificado.");
      } else if (data.devMode) {
        setInfo("Codigo reenviado (mira la consola del servidor).");
      } else {
        setInfo("Te enviamos un nuevo codigo. Revisa tu bandeja de entrada.");
      }
    } catch {
      setError("Error de conexion");
    }
    setResending(false);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-2 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl di-gradient flex items-center justify-center mb-2"><KeyRound className="h-7 w-7 text-white" /></div>
            <CardTitle className="font-display text-2xl">Verifica tu correo</CardTitle>
            <p className="text-sm text-muted-foreground">Enviamos un codigo de 6 digitos a <strong>{email}</strong></p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleVerify}>
              <div className="space-y-1.5">
                <Label>Codigo de verificacion</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="text-center text-2xl tracking-[0.5em] font-bold" maxLength={6} required />
              </div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              {info && <p className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2">{info}</p>}
              <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
                {verifying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verificando...</> : "Verificar y entrar"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={resending} onClick={handleResend}>
                {resending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reenviando...</> : "No me llego el codigo — reenviar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
