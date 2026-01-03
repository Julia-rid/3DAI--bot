"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";


export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<any>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    // Camera
    const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 1.4, 2.2);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, 0); // 顔あたりを中心に回す
    controls.enableDamping = true;   // ぬるっとさせる

    // Lights
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 1);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Loader (VRM plugin)
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/リン.vrm",
      (gltf) => {
        // 最適化（任意）
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          console.error("VRM not found: gltf.userData.vrm is empty");
          return;
        }

        vrm.scene.rotation.y = 0; // 正面向き（必要なら外す）
        scene.add(vrm.scene);
        vrmRef.current = vrm;

        console.log("VRM loaded OK");
      },
      undefined,
      (err) => console.error("Failed to load VRM:", err)
    );

    // Animate
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (vrmRef.current && vrmRef.current.update) vrmRef.current.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const onResize = () => {
      const m = mountRef.current;
      if (!m) return;
      camera.aspect = m.clientWidth / m.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(m.clientWidth, m.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />;
}
