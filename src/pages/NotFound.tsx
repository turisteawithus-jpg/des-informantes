import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center di-gradient-soft">
      <span className="text-6xl mb-4">📰</span>
      <h1 className="font-display text-4xl mb-2">Página no encontrada</h1>
      <p className="text-muted-foreground mb-6">Este canal no está en nuestra parrilla informativa.</p>
      <Button onClick={() => navigate("/")}>Volver al inicio</Button>
    </div>
  );
}
