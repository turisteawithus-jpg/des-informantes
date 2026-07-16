import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";

type Props = { onRecorded: (blob: Blob) => Promise<void>; disabled?: boolean };

export function AudioRecorder({ onRecorded, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          setUploading(true);
          try { await onRecorded(blob); } finally { setUploading(false); }
        }
      };
      recorder.start();
      mediaRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      alert("No se pudo acceder al micrófono. Verifica los permisos.");
    }
  }

  function stop() {
    mediaRef.current?.stop();
    mediaRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (uploading) {
    return (
      <Button variant="secondary" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Transcribiendo con IA…
      </Button>
    );
  }

  if (recording) {
    return (
      <Button variant="destructive" onClick={stop} className="gap-2 animate-rec">
        <Square className="h-4 w-4" /> Detener ({mm}:{ss})
      </Button>
    );
  }

  return (
    <Button variant="default" onClick={start} disabled={disabled} className="gap-2">
      <Mic className="h-4 w-4" /> Grabar audio
    </Button>
  );
}
