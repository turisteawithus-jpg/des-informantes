import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { Loader2, KeyRound } from "lucide-react";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const verify = trpc.auth.verifyEmail.useMutation({
    onSuccess: () => navigate("/dashboard"),
    onError: (e) => setError(e.message),
  });
  const resend = trpc.auth.resendCode.useMutation({
    onSuccess: (data) => {
      setInfo(data.alreadyVerified ? "Tu correo ya estaba verificado." : data.devMode ? "Código reenviado (míralo en la consola del servidor)." : "Te enviamos un nuevo código.");
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-2 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl di-gradient flex items-center justify-center mb-2"><KeyRound className="h-7 w-7 text-white" /></div>
            <CardTitle className="font-display text-2xl">Verifica tu correo</CardTitle>
            <p className="text-sm text-muted-foreground">Enviamos un código de 6 dígitos a <strong>{email}</strong></p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(""); verify.mutate({ email, code }); }}>
              <div className="space-y-1.5">
                <Label>Código de verificación</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="text-center text-2xl tracking-[0.5em] font-bold" maxLength={6} required />
              </div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              {info && <p className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2">{info}</p>}
              <Button type="submit" className="w-full" disabled={verify.isPending || code.length !== 6}>
                {verify.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verificando…</> : "Verificar y entrar"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={resend.isPending} onClick={() => { setError(""); setInfo(""); resend.mutate({ email }); }}>
                No me llegó el código — reenviar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
