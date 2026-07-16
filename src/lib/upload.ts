export async function uploadAudio(
  discussionId: number,
  blob: Blob,
): Promise<{ ok: boolean; transcriptionStatus: string; error?: string }> {
  const form = new FormData();
  form.append("discussionId", String(discussionId));
  form.append("file", blob, `audio-${Date.now()}.webm`);

  const resp = await fetch("/api/upload/audio", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  return resp.json();
}

export async function uploadDocument(params: {
  workspaceId: number;
  title: string;
  topic?: string;
  taskId?: number;
  discussionId?: number;
  file: File;
}): Promise<{ ok: boolean; documentId?: number; error?: string }> {
  const form = new FormData();
  form.append("workspaceId", String(params.workspaceId));
  form.append("title", params.title);
  if (params.topic) form.append("topic", params.topic);
  if (params.taskId) form.append("taskId", String(params.taskId));
  if (params.discussionId) form.append("discussionId", String(params.discussionId));
  form.append("file", params.file);

  const resp = await fetch("/api/upload/document", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  return resp.json();
}
