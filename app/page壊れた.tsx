"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

type Msg = { role: "user" | "assistant"; content: string };

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<any>(null);
  const talkingRef = useRef(false);
  const talkIdRef = useRef(0);
  const baseHipsYRef = useRef<number>(0);
  const basePoseRef = useRef<{
    captured: boolean;
    hipsY?: number;
    neck?: { x:number; y:number; z:number };
    spine?: { x:number; y:number; z:number };
    rUpper?: { x:number; y:number; z:number };
    rLower?: { x:number; y:number; z:number };
    lUpper?: { x:number; y:number; z:number };
    lLower?: { x:number; y:number; z:number };
  }>({ captured: false });

  type BonePose = { x: number; y: number; z: number };

  // ★ここに入れる（talkIdRefの直後）
  const gestureRef = useRef<{ until: number; kind: "nod" | "wave" | "none" }>({
    until: 0,
    kind: "none",
  });

  type BasePose = {
  hipsY: number;
  spineX: number;
  neckX: number;
  neckY: number;
  rUpperZ: number;
  rLowerZ: number;
  lUpperZ: number;
  lLowerZ: number;
};

  // ---- Chat state ----
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "こんにちは。何について話しましょうか？" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  type SpeakerItem = {
    name: string;
    speaker_uuid: string;
    styles: { id: number; name: string }[];
  };

  const [speakers, setSpeakers] = useState<SpeakerItem[]>([]);
  const [speakerId, setSpeakerId] = useState<number>(1);
  const [speakerFilter, setSpeakerFilter] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  // ---- Scroll chat to bottom ----
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function triggerGesture(kind: "nod" | "wave", ms = 900) {
    gestureRef.current = { kind, until: performance.now() + ms };
  }

  function applyRelaxedPose(vrm: any) {
    const hum = vrm?.humanoid;
    if (!hum?.setNormalizedPose) return;

    if (hum.resetNormalizedPose) hum.resetNormalizedPose();

    const q = (x: number, y: number, z: number) =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

    hum.setNormalizedPose({
      rightShoulder: { rotation: q(0, 0, -0.15) },
      leftShoulder:  { rotation: q(0, 0,  0.15) },

      rightUpperArm: { rotation: q(0.35, 0, -1.05) },
      leftUpperArm:  { rotation: q(0.35, 0,  1.05) },

      rightLowerArm: { rotation: q(-0.20, 0, -0.15) },
      leftLowerArm:  { rotation: q(-0.20, 0,  0.15) },
    });

    vrm.scene.updateMatrixWorld(true);
  }




  /** gesture（うなずき/手振り） ※必ずベース + 差分で上書き */
  function applyGesture(vrm: any, t: number) {
    const b = basePoseRef.current;
    if (!vrm || !b?.captured) return;

    const g = gestureRef.current;
    if (performance.now() > g.until) return;

    const neck = vrm.humanoid?.getNormalizedBoneNode?.("neck");
    const rUA  = vrm.humanoid?.getNormalizedBoneNode?.("rightUpperArm");
    const rLA  = vrm.humanoid?.getNormalizedBoneNode?.("rightLowerArm");

    if (g.kind === "nod" && neck && b.neck) {
      neck.rotation.x = b.neck.x + Math.sin(t * 10) * 0.12;
    }

    if (g.kind === "wave" && rUA && rLA && b.rUpper && b.rLower) {
      rUA.rotation.z = b.rUpper.z + Math.sin(t * 12) * -0.35;
      rLA.rotation.z = b.rLower.z + Math.sin(t * 16) * -0.25;
    }
  }


  function readRot(n: any) {
    return { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z };
  }
  function writeRot(n: any, r?: BonePose) {
    if (!n || !r) return;
    n.rotation.set(r.x, r.y, r.z);
  }

  function captureBasePose(vrm: any) {
    const b = basePoseRef.current;
    if (!vrm) return;

    const read = (name: any) => {
      const n = vrm.humanoid?.getNormalizedBoneNode?.(name);
      if (!n) return undefined;
      return { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z };
    };

    b.hipsY = vrm.humanoid?.getNormalizedBoneNode?.("hips")?.position.y ?? 0;
    b.neck  = read("neck");
    b.spine = read("spine");
    b.rUpper = read("rightUpperArm");
    b.rLower = read("rightLowerArm");
    b.lUpper = read("leftUpperArm");
    b.lLower = read("leftLowerArm");

    b.captured = true;
  }



  /** 毎フレーム「必ずベースに戻す」 */
  function resetToBase(vrm: any) {
    const b = basePoseRef.current;
    if (!vrm || !b || !b.captured) return;

    const neck = vrm.humanoid?.getNormalizedBoneNode?.("neck");
    const spine = vrm.humanoid?.getNormalizedBoneNode?.("spine");
    const rUpper = vrm.humanoid?.getNormalizedBoneNode?.("rightUpperArm");
    const rLower = vrm.humanoid?.getNormalizedBoneNode?.("rightLowerArm");
    const lUpper = vrm.humanoid?.getNormalizedBoneNode?.("leftUpperArm");
    const lLower = vrm.humanoid?.getNormalizedBoneNode?.("leftLowerArm");

    writeRot(neck, b.neck);
    writeRot(spine, b.spine);
    writeRot(rUpper, b.rUpper);
    writeRot(rLower, b.rLower);
    writeRot(lUpper, b.lUpper);
    writeRot(lLower, b.lLower);

    // hipsY もある時だけ
    const hips = vrm.humanoid?.getNormalizedBoneNode?.("hips");
    if (hips && typeof b.hipsY === "number") hips.position.y = b.hipsY;
  }


  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  function applyIdle(vrm: any, t: number) {
    const b = basePoseRef.current;
    if (!vrm || !b?.captured) return;

    const hips  = vrm.humanoid?.getNormalizedBoneNode?.("hips");
    const spine = vrm.humanoid?.getNormalizedBoneNode?.("spine");
    const neck  = vrm.humanoid?.getNormalizedBoneNode?.("neck");

    const breathe = Math.sin(t * 1.2) * 0.015;

    // hips は「ベース + 呼吸」にする（今は breathe で上書きしててズレる）
    if (hips && typeof b.hipsY === "number") hips.position.y = b.hipsY + breathe;

    // spine もベース + 微揺れ
    if (spine && b.spine) spine.rotation.x = b.spine.x + Math.sin(t * 1.2) * 0.03;

    // neck もベース + 微揺れ（+=は禁止。今のコメントは正しい）
    if (neck && b.neck) {
      neck.rotation.y = b.neck.y + Math.sin(t * 0.6) * 0.06;
      neck.rotation.x = b.neck.x + Math.sin(t * 0.9) * 0.03;
    }

    // 瞬きはそのままでOK
    const em = vrm.expressionManager;
    if (em) {
      const blinkPhase = t % 5.0;
      const blink =
        blinkPhase < 0.12 ? 1 - blinkPhase / 0.12 :
        blinkPhase < 0.24 ? (blinkPhase - 0.12) / 0.12 : 0;

      try { em.setValue("Blink", clamp01(blink)); } catch {}
      try { em.setValue("blink", clamp01(blink)); } catch {}
    }
  }




  // ---- Three.js / VRM ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const tex = new THREE.TextureLoader().load("/bg.png");
    scene.background = tex;

    const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 1.4, 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, 0);
    controls.enableDamping = true;
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 1);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    function fitCameraToObject(
      camera: THREE.PerspectiveCamera,
      controls: OrbitControls,
      object: THREE.Object3D,
      offset = 1.25
    ) {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // サイズがゼロなら、そもそもジオメトリが無い（=ロード失敗/非表示）
      if (size.length() === 0) {
        console.warn("fitCameraToObject: object size is 0 (no geometry?)");
        return;
      }

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      const dist = (maxDim / 2) / Math.tan(fov / 2);

      const newPos = center.clone().add(new THREE.Vector3(0, 0, dist * offset));
      camera.position.copy(newPos);
      camera.near = dist / 100;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();

      controls.target.copy(center);
      controls.update();
    }


    loader.load(
      "/リン.vrm",
      (gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          console.error("VRM not found: gltf.userData.vrm is empty");
          return;
        }
        try { VRMUtils.rotateVRM0(vrm); } catch {}


        function forceArmsDown(vrm: any) {
          const rUA = vrm.humanoid?.getNormalizedBoneNode?.("rightUpperArm");
          const lUA = vrm.humanoid?.getNormalizedBoneNode?.("leftUpperArm");
          const rLA = vrm.humanoid?.getNormalizedBoneNode?.("rightLowerArm");
          const lLA = vrm.humanoid?.getNormalizedBoneNode?.("leftLowerArm");

          // 値はモデルで向きが違うので「まずこれ」で当てて微調整して
          if (rUA) rUA.rotation.z += -1.0;
          if (lUA) lUA.rotation.z += +1.0;
          if (rLA) rLA.rotation.z += -0.2;
          if (lLA) lLA.rotation.z += +0.2;
        }

        function autoLowerArms(vrm: any) {
          const hum = vrm?.humanoid;
          if (!hum?.getNormalizedBoneNode) return;

          const rS  = hum.getNormalizedBoneNode("rightShoulder");
          const lS  = hum.getNormalizedBoneNode("leftShoulder");
          const rUA = hum.getNormalizedBoneNode("rightUpperArm");
          const lUA = hum.getNormalizedBoneNode("leftUpperArm");
          const rH  = hum.getNormalizedBoneNode("rightHand");
          const lH  = hum.getNormalizedBoneNode("leftHand");

          if (!rUA || !lUA || !rH || !lH) return;

          // 元に戻せるよう保存
          const save = (n: any) => (n ? n.rotation.clone() : null);
          const rS0 = save(rS), lS0 = save(lS), rUA0 = save(rUA), lUA0 = save(lUA);

          const vR = new THREE.Vector3();
          const vL = new THREE.Vector3();

          const candidates = {
            shoulderZ: [-0.6, -0.3, 0, 0.3, 0.6],
            upperX:    [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2],
            upperZ:    [-2.0, -1.6, -1.2, -0.8, -0.4, 0],
          };

          let best: any = null;
          let bestScore = Infinity;

          const apply = (sZ: number, uX: number, uZ: number) => {
            // 肩（ある場合）も少し回すのが効くモデルが多い
            if (rS) rS.rotation.z = (rS0?.z ?? 0) + sZ;
            if (lS) lS.rotation.z = (lS0?.z ?? 0) - sZ;

            // 上腕：左右対称に適用
            rUA.rotation.x = (rUA0?.x ?? 0) + uX;
            lUA.rotation.x = (lUA0?.x ?? 0) + uX;

            rUA.rotation.z = (rUA0?.z ?? 0) + uZ;
            lUA.rotation.z = (lUA0?.z ?? 0) - uZ;
          };

          for (const sZ of candidates.shoulderZ) {
            for (const uX of candidates.upperX) {
              for (const uZ of candidates.upperZ) {
                apply(sZ, uX, uZ);

                vrm.scene.updateMatrixWorld(true);
                rH.getWorldPosition(vR);
                lH.getWorldPosition(vL);

                // 手が低いほど良い（Yが小さいほど良い）
                let score = vR.y + vL.y;

                // 交差ペナルティ（右手が左側に来たら罰）
                if (vR.x < vL.x) score += 10;

                // 体の中心に寄りすぎも軽く罰（腕が前で交差しやすい）
                score += Math.max(0, 0.15 - Math.abs(vR.x)) * 2;
                score += Math.max(0, 0.15 - Math.abs(vL.x)) * 2;

                if (score < bestScore) {
                  bestScore = score;
                  best = { sZ, uX, uZ };
                }
              }
            }
          }

          // ベストを確定
          if (best) {
            apply(best.sZ, best.uX, best.uZ);
            console.log("autoLowerArms best:", best, "score:", bestScore);
          } else {
            // 念のため元に戻す
            if (rS && rS0) rS.rotation.copy(rS0);
            if (lS && lS0) lS.rotation.copy(lS0);
            if (rUA && rUA0) rUA.rotation.copy(rUA0);
            if (lUA && lUA0) lUA.rotation.copy(lUA0);
          }
        }

        basePoseRef.current = { captured: false }; // ★追加
        // 向きが背中ならここを 0 / Math.PI で調整
        vrm.scene.rotation.y = 0;

        applyRelaxedPose(vrm);
        // ★足元を地面(Y=0)に合わせる（安全版）
        vrm.update(0);
        vrm.scene.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(vrm.scene);
        const minY = box.min.y;

        if (Number.isFinite(minY)) {
          vrm.scene.position.y -= minY;
        } else {
          console.warn("minY is not finite. skip grounding:", minY);
        }
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        vrm.scene.visible = true;
        vrm.scene.scale.setScalar(1);
        fitCameraToObject(camera, controls, vrm.scene);
        // ★VRMを読み込むたびにベース姿勢を取り直す
        captureBasePose(vrm);    // ★この姿勢をベースとして固定


        console.log("VRM loaded OK");

        const em = vrmRef.current?.expressionManager;
        console.log("expression keys:", em ? Array.from(em.expressions.keys()) : "no expressionManager");

      },
      undefined,
      (err) => console.error("Failed to load VRM:", err)
    );

    const clock = new THREE.Clock();
    let raf = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (vrmRef.current?.update) vrmRef.current.update(delta);

      const vrm = vrmRef.current;
      const t = performance.now() / 1000;

      resetToBase(vrm);        // ★毎フレームまずベースに戻す（ぶれ防止）
      applyIdle(vrm, t);       // ★差分を足す
      applyGesture(vrm, t);    // ★差分を足す

      controls.update();
      renderer.render(scene, camera);
    };



    animate();

    const onResize = () => {
      const m = mountRef.current;
      if (!m) return;
      camera.aspect = m.clientWidth / m.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(m.clientWidth, m.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    fetch("/api/voicevox-speakers")
      .then((r) => r.json())
      .then((data) => setSpeakers(data))
      .catch((e) => console.warn("speakers fetch failed", e));
  }, []);


  const splitForTTS = (text: string) => {
    // 句点・読点・改行で分割（短い単位のほうが抑揚が安定）
    const raw = text
      .replace(/\n+/g, "。")
      .split(/(?<=[。！？!?])/)
      .map(s => s.trim())
      .filter(Boolean);

    // さらに長すぎる塊は「、」で割る
    const out: string[] = [];
    for (const s of raw) {
      if (s.length <= 40) {
        out.push(s);
      } else {
        const parts = s.split("、").map(x => x.trim()).filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i] + (i < parts.length - 1 ? "、" : "");
          out.push(p);
        }
      }
    }
    return out;
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = async (text: string) => {
    try {
      // 前の再生を止める
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      stopMouth();

      // ★ここを好みで調整（まずはこの値で）
      const speaker = speakerId; // ← あとで変更（/speakersで確認）
      const params = {
        speedScale: 1.3,        // 話速（上げると速い）
        pitchScale: 0.02,         // ピッチ（±で調整）
        intonationScale: 1.1,   // 抑揚（上げると抑揚強い）
        volumeScale: 1.0,
        prePhonemeLength: 0.0,
        postPhonemeLength: 0.09, // 余韻を少し短め（テンポよく）
      };

      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speaker, params }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.error("TTS error:", j?.error ?? r.statusText);
        return;
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplay = () => {
        const vrm = vrmRef.current;
        const emo = pickEmotion(text);
        clearEmotion(vrm);
        setExpression(vrm, emo, 0.8);

        triggerGesture(Math.random() < 0.6 ? "nod" : "wave", 900);

        startMouth(text);
      };
      audio.onended = () => {
        stopMouth();
        clearEmotion(vrmRef.current);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        stopMouth();
        clearEmotion(vrmRef.current);
        URL.revokeObjectURL(url);
      };


      await audio.play();
    } catch (e) {
      console.warn(e);
      stopMouth();
    }
  };


  // ★ 母音重み推定（超簡易・でも効く）
  const vowelWeightsFromText = (s: string) => {
    const map: Record<string, "a" | "i" | "u" | "e" | "o"> = {
      "あ":"a","か":"a","さ":"a","た":"a","な":"a","は":"a","ま":"a","や":"a","ら":"a","わ":"a",
      "が":"a","ざ":"a","だ":"a","ば":"a","ぱ":"a",
      "い":"i","き":"i","し":"i","ち":"i","に":"i","ひ":"i","み":"i","り":"i",
      "ぎ":"i","じ":"i","ぢ":"i","び":"i","ぴ":"i",
      "う":"u","く":"u","す":"u","つ":"u","ぬ":"u","ふ":"u","む":"u","ゆ":"u","る":"u",
      "ぐ":"u","ず":"u","づ":"u","ぶ":"u","ぷ":"u",
      "え":"e","け":"e","せ":"e","て":"e","ね":"e","へ":"e","め":"e","れ":"e",
      "げ":"e","ぜ":"e","で":"e","べ":"e","ぺ":"e",
      "お":"o","こ":"o","そ":"o","と":"o","の":"o","ほ":"o","も":"o","よ":"o","ろ":"o",
      "ご":"o","ぞ":"o","ど":"o","ぼ":"o","ぽ":"o",
    };

    // 最後の1文字だけ使う（簡単だけど十分）
    const ch = Array.from(s).filter(c => c.trim()).slice(-1)[0] ?? "";
    const v = map[ch] ?? "a";

    return {
      A: v === "a" ? 1 : 0.05,
      I: v === "i" ? 1 : 0.05,
      U: v === "u" ? 1 : 0.05,
      E: v === "e" ? 1 : 0.05,
      O: v === "o" ? 1 : 0.05,
    };
  };

  const startMouth = (text: string) => {
    const id = ++talkIdRef.current;
    talkingRef.current = true;

    const loop = async () => {
      while (talkingRef.current && talkIdRef.current === id) {
        const vrm = vrmRef.current;
        const em = vrm?.expressionManager;
        if (em) {
          const base = 0.25 + Math.random() * 0.75;
          const w = vowelWeightsFromText(text);

          // VRM1系（母音別）
          try { em.setValue("A", base * w.A); } catch {}
          try { em.setValue("I", base * w.I); } catch {}
          try { em.setValue("U", base * w.U); } catch {}
          try { em.setValue("E", base * w.E); } catch {}
          try { em.setValue("O", base * w.O); } catch {}

          // VRM0系の保険（aaしか無い場合）
          try { em.setValue("aa", base); } catch {}
        }

        await new Promise((r) => setTimeout(r, 80));
        const vrm2 = vrmRef.current;
        const em2 = vrm2?.expressionManager;
        if (em2) {
          try { em2.setValue("A", 0); } catch {}
          try { em2.setValue("I", 0); } catch {}
          try { em2.setValue("U", 0); } catch {}
          try { em2.setValue("E", 0); } catch {}
          try { em2.setValue("O", 0); } catch {}
          try { em2.setValue("aa", 0); } catch {}
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    loop();
  };

  const stopMouth = () => {
    talkingRef.current = false;

    const vrm = vrmRef.current;
    const em = vrm?.expressionManager;
    if (em) {
      try { em.setValue("aa", 0); } catch {}
      try { em.setValue("A", 0); } catch {}
    }
  };


  // ---- Send message ----
  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setBusy(true);

    const next = [...messages, { role: "user", content: text } as Msg];
    setMessages(next);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      const j = await r.json();

      if (!r.ok) {
        const err = `（APIエラー）${j?.error ?? "unknown"}`;
        setMessages((m) => [...m, { role: "assistant", content: err }]);
        return;
      }

      const reply = j.text ?? "";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);

      speak(reply);

    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `（通信エラー）${e?.message ?? "unknown"}` },
      ]);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 420px",
        height: "100vh",
        overflow: "hidden", // ★ページ全体が伸びるのを防ぐ
        background: "#111",
      }}
    >
      {/* Left: VRM */}
      <div ref={mountRef} style={{ height: "100%", width: "100%" }} />

      {/* Right: Chat */}
      <div
        style={{
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          padding: 14,
          color: "white",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
          minHeight: 0, // ★これが重要（flex内スクロールの定石）
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>VRM Chat</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{busy ? "thinking..." : "ready"}</div>
        </div>

        <div style={{ padding: 12, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
            VOICE（話者）
          </div>

          <input
            value={speakerFilter}
            onChange={(e) => setSpeakerFilter(e.target.value)}
            placeholder="検索（例：しずか / おだやか / クール）"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              marginBottom: 8,
              outline: "none",
            }}
          />

          <div style={{ maxHeight: 180, overflow: "auto", display: "grid", gap: 6 }}>
            {speakers
              .flatMap((sp) =>
                sp.styles.map((st) => ({
                  spName: sp.name,
                  stName: st.name,
                  id: st.id,
                }))
              )
              .filter((x) =>
                `${x.spName} ${x.stName}`
                  .toLowerCase()
                  .includes(speakerFilter.toLowerCase())
              )
              .slice(0, 60)
              .map((x) => (
                <button
                  key={x.id}
                  onClick={() => setSpeakerId(x.id)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border:
                      x.id === speakerId
                        ? "1px solid rgba(255,255,255,0.55)"
                        : "1px solid rgba(255,255,255,0.12)",
                    background:
                      x.id === speakerId
                        ? "rgba(255,255,255,0.10)"
                        : "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13 }}>
                    {x.spName} / {x.stName}
                  </div>
                </button>
              ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            選択中 speakerId: {speakerId}
          </div>

          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => speak("こんにちは。声の雰囲気を確認しています。")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
              }}
            >
              試聴
            </button>
          </div>
        </div>

        {/* ★この箱だけをスクロールさせる */}
        <div
          style={{
            flex: 1,
            minHeight: 0,              // ★これも重要
            overflowY: "auto",         // ★内部スクロール
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: 10,
          }}
        >
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 2 }}>
                {m.role === "user" ? "You" : "AI"}
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                  background: m.role === "user" ? "rgba(80,160,255,0.15)" : "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "8px 10px",
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 入力欄は常に下に固定 */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSend && send()}
            placeholder="メッセージを入力して Enter"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.35)",
              color: "white",
              outline: "none",
            }}
          />
          <button
            onClick={send}
            disabled={!canSend}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: canSend ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
              color: "white",
              cursor: canSend ? "pointer" : "not-allowed",
            }}
          >
            送信
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.65 }}>
          ※ まずはテキスト会話。次に音声（TTS）と口パクを追加します。
        </div>
      </div>
    </div>
  );
}

function setExpression(vrm: any, name: string, v: number) {
  const em = vrm?.expressionManager;
  if (!em) return;

  // まず直接指定（VRM1系で生えることがある）
  try { em.setValue(name, v); } catch {}

  // よくある別名
  const alt: Record<string, string[]> = {
    happy: ["Joy", "joy", "Happy", "happy"],
    angry: ["Angry", "angry"],
    sad: ["Sorrow", "sorrow", "Sad", "sad"],
    surprised: ["Surprised", "surprised"],
    relaxed: ["Fun", "fun", "Relaxed", "relaxed"],
  };
  (alt[name] ?? []).forEach((n) => { try { em.setValue(n, v); } catch {} });
}

function clearEmotion(vrm: any) {
  ["happy", "angry", "sad", "surprised", "relaxed"].forEach((k) => setExpression(vrm, k, 0));
}

function pickEmotion(text: string) {
  if (/[！!]/.test(text)) return "happy";
  if (/(怒|むか|許せ|最悪)/.test(text)) return "angry";
  if (/(悲|つら|ごめん|すま)/.test(text)) return "sad";
  if (/(えっ|まじ|本当|びっくり)/.test(text)) return "surprised";
  return "relaxed";
}