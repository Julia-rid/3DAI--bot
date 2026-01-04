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

  function easeInOutSine(x: number) {
    // 0→1 を滑らかに
    return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
  }

  function clamp(x: number, a: number, b: number) {
    return Math.max(a, Math.min(b, x));
  }

  function clampEulerZXY(node: any, lim: {x?:[number,number], y?:[number,number], z?:[number,number]}) {
    if (!node) return;
    if (lim.x) node.rotation.x = clamp(node.rotation.x, lim.x[0], lim.x[1]);
    if (lim.y) node.rotation.y = clamp(node.rotation.y, lim.y[0], lim.y[1]);
    if (lim.z) node.rotation.z = clamp(node.rotation.z, lim.z[0], lim.z[1]);
  }

  function pickWeighted<T extends string>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1][0];
  }

  type BonePose = { x: number; y: number; z: number };


  type GestureKind =
    | "nod"
    | "wave"
    | "tilt"
    | "shake"
    | "shrug"
    | "smallWave"
    | "cheer"
    | "waveOverhead"
    | "none";

  type GestureState = {
    kind: GestureKind;
    until: number;
    strength?: number;
  };

  // ★ここに入れる（talkIdRefの直後）
  const gestureRef = useRef<GestureState>({
    kind: "none",
    until: 0,
    strength: 1.0,
  });

  function setGesture(kind: GestureKind, ms = 1200, strength = 1.0) {
    gestureRef.current = {
      kind,
      until: performance.now() + ms,
      strength,
    };
  }


  function triggerGestureFromText(text: string) {
    // 挨拶/別れ
    if (/(こんにちは|おはよう|こんばんは|またね|ばいばい|バイバイ)/.test(text)) {
      setGesture("smallWave", 1400, 1.0);
      return;
    }

    // 困り/迷い
    if (/(わから|分から|うーん|困|微妙|たぶん|かも)/.test(text)) {
      const kind = pickWeighted([["shrug", 0.5], ["tilt", 0.5]] as const);
      setGesture(kind, 1400, 0.9);
      return;
    }

    // 否定
    if (/(違い|ちがい|できません|無理|むり|難しい|だめ)/.test(text)) {
      setGesture("shake", 1200, 0.9);
      return;
    }

    // 喜び/称賛
    if (/(やった|すごい|おめでとう|最高|天才|成功)/.test(text)) {
      const kind = pickWeighted([["waveOverhead", 0.6], ["cheer", 0.4]] as const);
      setGesture(kind, 1600, 1.1);
      return;
    }

    // fallback
    const fallback = pickWeighted([["nod", 0.60], ["tilt", 0.25], ["smallWave", 0.15]] as const);
    setGesture(fallback, 1100, 0.6);
  }


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
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState(""); // 途中結果（任意）
  const recognitionRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  type SpeakerItem = {
    name: string;
    speaker_uuid: string;
    styles: { id: number; name: string }[];
  };

  const [speakers, setSpeakers] = useState<SpeakerItem[]>([]);
  const [speakerId, setSpeakerId] = useState<number>(66);
  const [speakerFilter, setSpeakerFilter] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  // ---- Scroll chat to bottom ----
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    // Next/app でも一応ガード（"use client" なので基本は動く）
    if (typeof window === "undefined") return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn("SpeechRecognition not supported in this browser.");
      return;
    }

    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = true;       // 長めに話すなら true
    rec.interimResults = true;   // 途中結果を取る
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += txt;
        else interim += txt;
      }

      if (interim) setInterimText(interim);

      if (final) {
        setInterimText("");
        // 入力欄へ追記（置換にしたいなら prev を捨てて final だけに）
        setInput((prev) => (prev ? prev + " " : "") + final.trim());
      }
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimText("");
    };

    rec.onerror = (e: any) => {
      console.warn("SpeechRecognition error:", e);
      setIsListening(false);
      setInterimText("");
    };

    recognitionRef.current = rec;

    return () => {
      try { rec.stop(); } catch {}
    };
  }, []);


  function triggerGesture(kind: "nod" | "wave" | "tilt" | "shake" | "shrug" | "smallWave" | "cheer" , ms = 900) {
    gestureRef.current = { kind, until: performance.now() + ms };
  }

  function applyRelaxedPose(vrm: any) {
    const hum = vrm?.humanoid;
    if (!hum?.getNormalizedBoneNode) return;

    const rS  = hum.getNormalizedBoneNode("rightShoulder");
    const lS  = hum.getNormalizedBoneNode("leftShoulder");
    const rUA = hum.getNormalizedBoneNode("rightUpperArm");
    const lUA = hum.getNormalizedBoneNode("leftUpperArm");
    const rLA = hum.getNormalizedBoneNode("rightLowerArm");
    const lLA = hum.getNormalizedBoneNode("leftLowerArm");

    // 肩：少しだけ下げる（モデル依存が少ない範囲）
    if (rS) rS.rotation.z = -0.25;
    if (lS) lS.rotation.z =  0.25;

    // 上腕：軽く前に/下に（大きく回さない）
    if (rUA) { rUA.rotation.x = 0.25; rUA.rotation.z = 1.5; }
    if (lUA) { lUA.rotation.x = 0.25; lUA.rotation.z =  -1.5; }

    // 前腕：少し曲げる（手が体に刺さりにくくなる）
    if (rLA) { rLA.rotation.x = -0.1; rLA.rotation.y = 0.5; rLA.rotation.z = -0.10; }
    if (lLA) { lLA.rotation.x = -0.1; lLA.rotation.y = -0.5; lLA.rotation.z =  -0.10; }
  }


  /** gesture（うなずき/手振り/他） ※必ずベース + 差分で上書き */
  function applyGesture(vrm: any, t: number) {
    const b = basePoseRef.current;
    if (!vrm || !b?.captured) return;

    const g = gestureRef.current;
    if (!g || performance.now() > g.until) return;

    const hum = vrm.humanoid;
    const get = hum?.getNormalizedBoneNode?.bind(hum);
    if (!get) return;

    const neck = get("neck");
    const spine = get("spine");
    const chest = get("chest"); // ないモデルもある
    const rS = get("rightShoulder");
    const lS = get("leftShoulder");
    const rUA = get("rightUpperArm");
    const rLA = get("rightLowerArm");
    const lUA = get("leftUpperArm");
    const lLA = get("leftLowerArm");

    // 強さ（任意：g.strength がなければ 1.0）
    const k = typeof g.strength === "number" ? g.strength : 1.0;

    // ---- nod（既存） ----
    if (g.kind === "nod" && neck && b.neck) {
      neck.rotation.x = b.neck.x + Math.sin(t * 10) * 0.12 * k;
      return;
    }

    // ---- tilt：首かしげ（会話で使いやすい） ----
    if (g.kind === "tilt" && neck && b.neck) {
      neck.rotation.z = b.neck.z + Math.sin(t * 6) * 0.16 * k;
      clampEulerZXY(neck, { x: [-0.35, 0.35] });
      return;
    }

    // ---- shake：首ふり（軽い否定） ----
    if (g.kind === "shake" && neck && b.neck) {
      neck.rotation.y = b.neck.y + Math.sin(t * 8) * 0.20 * k;
      clampEulerZXY(neck, { y: [-0.45, 0.45] });
      return;
    }

    // ---- shrug：肩すくめ（困り/照れ） ----
    if (g.kind === "shrug") {
      // 肩を少し上げる感じ：肩のzを少し寄せて、上半身もほんの少し動かす
      const s = (Math.sin(t * 10) * 0.01) * k; // 上げっぱなし寄り
      if (rS) rS.rotation.z = (rS.rotation.z ?? 0) - s;
      if (lS) lS.rotation.z = (lS.rotation.z ?? 0) + s;
      return;
    }

    // ---- smallWave：控えめ手振り（貫通しにくい） ----
    if (g.kind === "smallWave" && rUA && rLA && b.rUpper && b.rLower) {
      const s1 = Math.sin(t * 10);
      const s2 = Math.sin(t * 14);

      // 体の外側に逃がす（貫通防止）
      rUA.rotation.y = (b.rUpper.y ?? 0) - 0.15 * k;
      rUA.rotation.x = (b.rUpper.x ?? 0) - 0.10 * k;

      // 振り幅は小さく
      rUA.rotation.z = b.rUpper.z + s1 * 0.12 * k;
      rLA.rotation.z = b.rLower.z + s2 * 0.10 * k;

      // 肘を少し曲げる（見栄え＆貫通防止）
      rLA.rotation.x = (b.rLower.x ?? 0) - 0.65 * k;


      // ★角度上限（人外防止）
      clampEulerZXY(rUA, { x: [-1.2, 0.6], y: [-1.0, 1.0], z: [-2.2, 2.2] });
      clampEulerZXY(rLA, { x: [-1.6, 0.2], z: [-1.2, 1.2] });
      return;
    }

    // ---- wave（既存の手振り：安全版に置き換え推奨） ----
    if (g.kind === "wave" && rUA && rLA && b.rUpper && b.rLower) {
      const s1 = Math.sin(t * 12);
      const s2 = Math.sin(t * 16);

      // 外側/前へ逃がす（ここが重要）
      rUA.rotation.y = (b.rUpper.y ?? 0) - 0.20 * k;
      rUA.rotation.x = (b.rUpper.x ?? 0) - 0.12 * k;

      // 振り
      rUA.rotation.z = b.rUpper.z + s1 * 0.18 * k;
      rLA.rotation.z = b.rLower.z + s2 * 0.12 * k;

      // 肘：もう少し曲げたいならここを強める
      rLA.rotation.x = (b.rLower.x ?? 0) - 0.75 * k;

      clampEulerZXY(rUA, { x: [-1.2, 0.6], y: [-1.0, 1.0], z: [-2.2, 2.2] });
      clampEulerZXY(rLA, { x: [-1.6, 0.2], z: [-1.2, 1.2] });
      return;
    }

    // ---- waveOverhead：両手を頭上で振る（リアクション向け） ----
    if (g.kind === "waveOverhead") {
      const s = Math.sin(t * 10);
      const sFast = Math.sin(t * 18);

      // 上半身もほんの少し“ノる”
      if (spine && b.spine) spine.rotation.y = (b.spine.y ?? 0) + s * 0.05 * k;

      const setOver = (UA: any, LA: any, side: 1 | -1, bu?: any, bl?: any) => {
        if (!UA || !LA) return;
        const _bu = bu ?? { x: 0, y: 0, z: 0 };
        const _bl = bl ?? { x: 0, y: 0, z: 0 };

        // ★腕を上げる：モデルによって x と z が逆に効くことがある
        // あなたのモデルは z が強く効く可能性が高いので、まず z で上げる版にしておく
        UA.rotation.z = (_bu.z ?? 0) + side * 1.05 * k;     // 上げる
        UA.rotation.y = (_bu.y ?? 0) + side * 0.30 * k;     // 外に開く
        UA.rotation.x = (_bu.x ?? 0) - 0.10 * k;            // 少し前

        // 頭上で振る（軽く）
        UA.rotation.y += sFast * 0.12 * k;

        // 肘を伸ばし気味
        LA.rotation.x = (_bl.x ?? 0) - 0.10 * k;
        LA.rotation.z = (_bl.z ?? 0) + sFast * 0.10 * k;
      };

      setOver(rUA, rLA,  1, b.rUpper, b.rLower);
      setOver(lUA, lLA, -1, b.lUpper, b.lLower);

      // ★頭上は“特に”人外になりやすいので強めにクランプ
      clampEulerZXY(rUA, { x: [-1.4, 0.8], y: [-1.2, 1.2], z: [-2.0, 2.0] });
      clampEulerZXY(lUA, { x: [-1.4, 0.8], y: [-1.2, 1.2], z: [-2.0, 2.0] });
      clampEulerZXY(rLA, { x: [-0.6, 0.4] });
      clampEulerZXY(lLA, { x: [-0.6, 0.4] });
      return;
    }

    // ---- cheer：片手ガッツポーズ（貫通少なめ） ----
    if (g.kind === "cheer" && rUA && rLA && b.rUpper && b.rLower) {
      const s = Math.sin(t * 10);

      // 上げる（モデル依存：まず z で）
      rUA.rotation.z = (b.rUpper.z ?? 0) + 1.2 * k;
      rUA.rotation.y = (b.rUpper.y ?? 0) - 0.15 * k;

      // 肘は曲げる
      rLA.rotation.x = (b.rLower.x ?? 0) - 0.85 * k;

      // 小さく揺らす
      rLA.rotation.z = (b.rLower.z ?? 0) + s * 0.10 * k;

      clampEulerZXY(rUA, { x: [-1.2, 0.8], y: [-1.0, 1.0], z: [-2.0, 2.0] });
      clampEulerZXY(rLA, { x: [-1.6, 0.2], z: [-1.0, 1.0] });
      return;
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
        applyRelaxedPose(vrm);   // ★固定の休め姿勢
        vrm.update(0);           // ★正規化→実ボーンへ反映（これ大事）
        // ★足元を地面(Y=0)に合わせる
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const minY = box.min.y;
        vrm.scene.position.y -= minY;
        scene.add(vrm.scene);
        vrmRef.current = vrm;
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

        //triggerGesture(Math.random() < 0.6 ? "nod" : "wave": "tilt" : "shake" : "shrug" : "smallWave" : "cheer" , 900);
        triggerGestureFromText(text);

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

  function startListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      setInterimText("");
      rec.start();
      setIsListening(true);
    } catch (e) {
      // start連打で例外になることがある
      console.warn(e);
    }
  }

  function stopListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch (e) {
      console.warn(e);
    }
    setIsListening(false);
    setInterimText("");
  }

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

          {/* ★追加：音声入力ボタン */}
          <button
            onClick={isListening ? stopListening : startListening}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: isListening ? "rgba(255,80,80,0.22)" : "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              minWidth: 44,
            }}
            title={isListening ? "音声入力を停止" : "音声入力を開始"}
          >
            {isListening ? "■" : "🎤"}
          </button>

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