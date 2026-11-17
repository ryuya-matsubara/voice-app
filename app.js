const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);
const ui = (id) => elements[id];
const maxRecordingMs = 30_000;
const preferredFormats = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"];
const extensions = {
  "audio/mp4": "m4a", "video/mp4": "mp4", "audio/webm": "weba",
  "video/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/aac": "aac",
};

let connection;
let busyConnection = false;
let busyMicrophone = false;
let busySave = false;
let busySpeech = false;
let recording;
let reference;
let voices = [];

function status(id, message, error = false) {
  ui(id).textContent = message;
  ui(id).dataset.error = String(error);
}

function showConnection(show) {
  ui("connection-panel").hidden = !show;
  ui("connection-toggle").setAttribute("aria-expanded", String(show));
}

function render() {
  const connected = Boolean(connection);
  const working = busySave || busySpeech || busyMicrophone || Boolean(recording);
  ui("connection-toggle").dataset.connected = String(connected);
  ui("connection-label").textContent = connected ? "接続中" : "未接続";
  for (const id of ["server", "key", "connect"]) {
    ui(id).disabled = connected || busyConnection;
  }
  ui("disconnect").hidden = !connected;
  ui("disconnect").disabled = busyConnection || working;
  ui("record").disabled = !connected || busyMicrophone || busySave;
  ui("record").setAttribute("aria-pressed", String(Boolean(recording)));
  ui("record-label").textContent = recording ? "録音を停止" : reference ? "録り直す" : "録音を開始";
  ui("recorder").dataset.recording = String(Boolean(recording));
  ui("save-voice").disabled = !connected || !reference || Boolean(recording) || busyMicrophone || busySave;
  ui("voice-name").disabled = busySave;
  ui("voice").disabled = !connected || !voices.length || busySpeech;
  ui("generate").disabled = !connected || !ui("voice").value || busySpeech;
}

function setVoices(profiles, selected = ui("voice").value) {
  voices = profiles.filter((profile) =>
    profile && typeof profile.id === "string" && typeof profile.name === "string"
    && (profile.kind === "clone" || (!profile.kind && Boolean(profile.ref_audio_path))),
  );
  const options = voices.map((profile) => new Option(profile.name, profile.id));
  ui("voice").replaceChildren(...(options.length ? options : [new Option("声を登録すると選べます", "")]));
  if (voices.some((profile) => profile.id === selected)) ui("voice").value = selected;
  render();
}

class VoiceStudioError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function serverOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("VoiceStudio の HTTPS URL を入力してください。URL はホスト名まで指定します。");
  }
  return url.origin;
}

async function api(origin, token, path, { method = "GET", body, json = false, signal } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(new URL(path, origin), {
      method, headers, body: json ? JSON.stringify(body) : body, signal,
      credentials: "omit", redirect: "error", cache: "no-store",
    });
  } catch {
    throw new Error("VoiceStudio にアクセスできません。PC の起動、URL、ネットワーク、許可オリジンの設定を確認してください。");
  }
  if (response.ok) return response;
  const result = await response.json().catch(() => null);
  const detail = [result?.detail, result?.error?.message].find((value) => typeof value === "string");
  throw new VoiceStudioError(response.status, detail?.slice(0, 220) ?? `VoiceStudio エラー（${response.status}）`);
}

function clearConnection() {
  connection = undefined;
  setVoices([]);
  setAudio("speech-audio", null);
  showConnection(true);
}

async function currentApi(path, options) {
  const current = connection;
  if (!current) throw new Error("先に VoiceStudio に接続してください。");
  try {
    return await api(current.origin, current.token, path, options);
  } catch (error) {
    if (error.statusCode === 401 && connection === current) {
      clearConnection();
      const message = "接続の有効期限が切れました。API キーを入力して再接続してください。";
      status("connection-status", message, true);
      throw new Error(message);
    }
    throw error;
  }
}

ui("connection-toggle").addEventListener("click", () => showConnection(ui("connection-panel").hidden));

ui("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busyConnection || connection) return;
  let origin;
  try {
    origin = serverOrigin(ui("server").value.trim());
  } catch {
    status("connection-status", "VoiceStudio の HTTPS URL をホスト名まで入力してください。", true);
    return;
  }
  const key = ui("key").value.trim();
  if (!key) return;
  ui("key").value = "";
  busyConnection = true;
  render();
  status("connection-status", "VoiceStudio に接続しています…");
  let token;
  try {
    const response = await api(origin, key, "/api/auth/session", {
      method: "POST", body: { transport: "bearer" }, json: true, signal: AbortSignal.timeout(20_000),
    });
    ({ token } = await response.json());
    if (typeof token !== "string" || !token.startsWith("ovs_admin_session_")) {
      throw new Error("VoiceStudio の接続応答を確認できません。");
    }
    const list = await api(origin, token, "/profiles", { signal: AbortSignal.timeout(20_000) });
    const profiles = await list.json();
    if (!Array.isArray(profiles)) throw new Error("登録済みの声を取得できません。");
    connection = { origin, token };
    setVoices(profiles);
    ui("server").value = origin;
    status("connection-status", "VoiceStudio に接続しました。");
    showConnection(false);
    ui("connection-toggle").focus();
  } catch (error) {
    if (token) {
      void api(origin, token, "/api/auth/session", {
        method: "DELETE", signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    const message = error.statusCode === 401 ? "API キーを確認してください。" : error.message;
    status("connection-status", message, true);
  } finally {
    busyConnection = false;
    render();
  }
});

ui("disconnect").addEventListener("click", async () => {
  if (!connection || busyConnection || busySave || busySpeech || busyMicrophone || recording) return;
  const { origin, token } = connection;
  busyConnection = true;
  clearConnection();
  status("record-status", "");
  status("speech-status", "");
  status("connection-status", "接続を解除しています…");
  try {
    await api(origin, token, "/api/auth/session", {
      method: "DELETE", signal: AbortSignal.timeout(5000),
    });
    status("connection-status", "接続を解除しました。");
  } catch {
    status("connection-status", "ブラウザの接続情報を消去しました。サーバー側のセッション解除は確認できませんでした。", true);
  } finally {
    busyConnection = false;
    render();
  }
});

function setAudio(id, blob) {
  const audio = ui(id);
  const oldUrl = audio.getAttribute("src");
  audio.pause();
  if (blob) {
    audio.src = URL.createObjectURL(blob);
  } else {
    audio.removeAttribute("src");
  }
  audio.load();
  audio.hidden = !blob;
  if (oldUrl) URL.revokeObjectURL(oldUrl);
}

function setReference(clip) {
  reference = clip;
  setAudio("reference-audio", clip?.blob);
  ui("voice-form").hidden = !clip;
}

function setElapsed(milliseconds) {
  const seconds = Math.floor(Math.min(milliseconds, maxRecordingMs) / 1000);
  ui("elapsed").textContent = `00:${String(seconds).padStart(2, "0")}`;
}

function stopRecording() {
  if (recording?.recorder.state === "recording") recording.recorder.stop();
}

function finishRecording(session, error) {
  clearInterval(session.timer);
  clearTimeout(session.deadline);
  session.stream.getTracks().forEach((track) => track.stop());
  if (recording !== session) return;
  recording = undefined;
  const duration = performance.now() - session.startedAt;
  setElapsed(duration);
  const type = session.chunks[0]?.type || session.recorder.mimeType;
  const extension = extensions[type.split(";")[0].trim().toLowerCase()];
  if (error) {
    status("record-status", "録音中にエラーが発生しました。もう一度録音してください。", true);
  } else if (!extension || duration < 1000 || !session.chunks.length) {
    status("record-status", "使える録音がありません。1秒以上、声を入れて録音してください。", true);
  } else {
    const blob = new Blob(session.chunks, { type });
    setReference({ blob, extension });
    status("record-status", "録音を確認して、声に名前を付けて登録できます。");
  }
  render();
}

ui("record").addEventListener("click", async () => {
  if (recording) {
    stopRecording();
    return;
  }
  if (!connection || busyMicrophone || busySave) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status("record-status", "このブラウザではマイク録音を利用できません。", true);
    return;
  }
  busyMicrophone = true;
  render();
  status("record-status", "マイクの許可を確認しています…");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!connection) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mimeType = preferredFormats.find((format) => MediaRecorder.isTypeSupported?.(format));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const session = { recorder, stream, chunks: [], startedAt: performance.now() };
    recorder.addEventListener("dataavailable", ({ data }) => {
      if (data.size) session.chunks.push(data);
    });
    recorder.addEventListener("stop", () => finishRecording(session), { once: true });
    recorder.addEventListener("error", () => finishRecording(session, true), { once: true });
    recorder.start();
    recording = session;
    setReference(null);
    setElapsed(0);
    session.timer = setInterval(() => setElapsed(performance.now() - session.startedAt), 200);
    session.deadline = setTimeout(stopRecording, maxRecordingMs);
    status("record-status", "録音中です。30秒で自動停止します。");
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    const message = error.name === "NotAllowedError" ? "ブラウザでマイクへのアクセスを許可してください。"
      : "マイクを開始できません。マイクが利用できるか確認してください。";
    status("record-status", message, true);
  } finally {
    busyMicrophone = false;
    render();
  }
});

window.addEventListener("pagehide", () => {
  if (!recording) return;
  stopRecording();
  recording.stream.getTracks().forEach((track) => track.stop());
});

ui("voice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = ui("voice-name").value.trim();
  if (!name || !reference || !connection || busySave || recording || busyMicrophone) return;
  const body = new FormData();
  body.append("name", name);
  body.append("kind", "clone");
  body.append("ref_audio", reference.blob, `recording.${reference.extension}`);
  busySave = true;
  render();
  status("record-status", "VoiceStudio に声を登録しています…");
  try {
    const response = await currentApi("/profiles", { method: "POST", body });
    const profile = await response.json();
    if (typeof profile.id !== "string" || typeof profile.name !== "string") {
      throw new Error("登録した声の情報を取得できませんでした。");
    }
    if (connection) setVoices([profile, ...voices.filter((voice) => voice.id !== profile.id)], profile.id);
    setReference(null);
    setElapsed(0);
    ui("voice-name").value = "";
    status("record-status", `「${profile.name}」を登録しました。`);
  } catch (error) {
    status("record-status", error.message, true);
  } finally {
    busySave = false;
    render();
  }
});

ui("voice").addEventListener("change", render);

ui("speech-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const voice = ui("voice").value;
  const input = ui("script").value.trim();
  if (!connection || !voice || !input || busySpeech) return;
  const current = connection;
  busySpeech = true;
  render();
  setAudio("speech-audio", null);
  status("speech-status", "読み上げ音声を生成しています。初回は時間がかかることがあります…");
  try {
    const response = await currentApi("/v1/audio/speech", {
      method: "POST", json: true,
      body: { model: "tts-1", voice, input, response_format: "wav" },
    });
    const audio = await response.blob();
    if (!audio.size || !audio.type.startsWith("audio/")) {
      throw new Error("VoiceStudio から音声を受け取れませんでした。");
    }
    if (connection !== current) return;
    setAudio("speech-audio", audio);
    status("speech-status", "読み上げ音声ができました。");
    void ui("speech-audio").play().catch(() => {});
  } catch (error) {
    status("speech-status", error.message, true);
  } finally {
    busySpeech = false;
    render();
  }
});

render();
