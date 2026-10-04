/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { motion, AnimatePresence, animate } from 'motion/react';
import { Activity, Settings, X, Video, Download, RotateCcw, Star, Info } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App as AppPlugin } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Browser } from '@capacitor/browser';

interface DataNode {
  obj: THREE.Sprite;
  birth: number;
  emissionTime: number;
  freq: number;
  amp: number;
  color: THREE.Color;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  lastLifetimeUpdate: number;
}

const DEFAULTS = {
  fftSize: 4096,
  smoothing: 0.1,
  palette: 'Sunset',
  nodeLife: 25,
  nodeDensity: 10,
  bloomStrength: 0.2,
  orbitSpeed: 0.4,
  connectionDist: 8.0,
  manifoldScale: 1.0,
  highPassFreq: 100,
  lowPassFreq: 20000,
  noiseGate: 5,
  eqBands: {
    60: 0,
    170: 0,
    310: 0,
    600: 0,
    1000: 0,
    3000: 0,
    6000: 0,
    12000: 0,
    14000: 0,
    16000: 0
  }
};

const loadConfig = () => {
  try {
    const saved = localStorage.getItem('pickko-config');
    if (saved) return JSON.parse(saved);
  } catch (e) {
    // Production silent
  }
  return DEFAULTS;
};

// --- Subcomponents ---

// --- Rating Prompt ---
const RatingPrompt = ({ onClose, onRate }: { onClose: () => void, onRate: () => void }) => {
  return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 pointer-events-auto">
        <motion.div 
           initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
           className="glass-card w-full max-w-sm p-8 flex flex-col items-center justify-center relative text-center border border-white/15"
        >
             <button onClick={onClose} aria-label="Dismiss Rating" className="absolute top-4 right-4 text-white/50 hover:text-white cursor-pointer transition-colors">
               <X size={18} />
             </button>
             <Star className="w-12 h-12 text-yellow-400/90 mb-6 drop-shadow-[0_0_15px_rgba(250,204,21,0.4)]" />
             <h3 className="text-white uppercase tracking-[0.15em] text-sm font-bold mb-3">Resonance Found</h3>
             <p className="text-white/50 text-[10px] tracking-widest uppercase leading-relaxed mb-8 max-w-[250px]">
               If Birdsong Visualizer resonates with your frequency, please consider reviewing us.
             </p>
             <button onClick={onRate} className="w-full glass-pill py-3 text-white uppercase tracking-widest text-[10px] font-bold hover:bg-white/20 transition-all mb-4 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.05)]">
               Rate on Play Store
             </button>
             <button onClick={onClose} className="text-white/30 text-[9px] uppercase tracking-widest hover:text-white/60 transition-colors cursor-pointer">
               Maybe Later
             </button>
        </motion.div>
      </div>
  );
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // UI Display Refs (Optimized for performance outside of React State)
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const ampDisplayRef = useRef<HTMLSpanElement>(null);
  const spectralBarRef = useRef<HTMLDivElement>(null);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [showControls, setShowControls] = useState(false);
  
  const configInit = useMemo(() => loadConfig(), []);
  
  // Configuration State
  const [fftSize, setFftSize] = useState(configInit.fftSize ?? DEFAULTS.fftSize);
  const [smoothing, setSmoothing] = useState(configInit.smoothing ?? DEFAULTS.smoothing);
  const [palette, setPalette] = useState(configInit.palette ?? DEFAULTS.palette);
  const [nodeLife, setNodeLife] = useState(configInit.nodeLife ?? DEFAULTS.nodeLife);
  const [nodeDensity, setNodeDensity] = useState(configInit.nodeDensity ?? DEFAULTS.nodeDensity);
  const [bloomStrength, setBloomStrength] = useState(configInit.bloomStrength ?? DEFAULTS.bloomStrength);
  const [orbitSpeed, setOrbitSpeed] = useState(configInit.orbitSpeed ?? DEFAULTS.orbitSpeed);
  const [connectionDist, setConnectionDist] = useState(configInit.connectionDist ?? DEFAULTS.connectionDist);
  const [manifoldScale, setManifoldScale] = useState<number>(configInit.manifoldScale ?? DEFAULTS.manifoldScale);
  const [highPassFreq, setHighPassFreq] = useState<number>(configInit.highPassFreq ?? DEFAULTS.highPassFreq);
  const [lowPassFreq, setLowPassFreq] = useState<number>(configInit.lowPassFreq ?? DEFAULTS.lowPassFreq);
  const [noiseGate, setNoiseGate] = useState<number>(configInit.noiseGate ?? DEFAULTS.noiseGate);
  const [eqBands, setEqBands] = useState<Record<string, number>>(configInit.eqBands ?? DEFAULTS.eqBands);
  const [activeTab, setActiveTab] = useState<'essence' | 'resonance'>('essence');

  // Feedback & Rating State
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const happyPathCountRef = useRef(0);

  useEffect(() => {
    try {
      const state = { fftSize, smoothing, palette, nodeLife, nodeDensity, bloomStrength, orbitSpeed, connectionDist, manifoldScale, highPassFreq, lowPassFreq, noiseGate, eqBands };
      localStorage.setItem('pickko-config', JSON.stringify(state));
    } catch (e) {
      // Production silent
    }
  }, [fftSize, smoothing, palette, nodeLife, nodeDensity, bloomStrength, orbitSpeed, connectionDist, manifoldScale, highPassFreq, lowPassFreq, noiseGate, eqBands]);

  // Native Platform Lifecycle
  useEffect(() => {
    // PWA Installation logic
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    const handleAppInstalled = () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    let backListener: any = null;
    
    if (Capacitor.isNativePlatform()) {
      // Configure Status Bar
      StatusBar.setStyle({ style: Style.Dark });
      
      // Handle Android Back Button
      backListener = AppPlugin.addListener('backButton', ({ canGoBack }) => {
        if (!canGoBack) {
          if (showControls) {
            setShowControls(false);
          } else {
            AppPlugin.exitApp();
          }
        }
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (backListener) {
        backListener.remove();
      }
    };
  }, [showControls]);

  useEffect(() => {
    if (isInitialized && Capacitor.isNativePlatform()) {
       SplashScreen.hide();
    }
  }, [isInitialized]);

  const handleRateApp = () => {
    localStorage.setItem('pickko-has-rated', 'true');
    setShowRatingPrompt(false);
    // In a production PWA or TWA snippet, this routes to the real Play Store URI
    if (typeof window !== 'undefined') {
       window.open('https://play.google.com/store/apps/details?id=com.birdsong.visualizer', '_blank');
    }
  };

  const resetToDefaults = () => {
    setFftSize(DEFAULTS.fftSize);
    setSmoothing(DEFAULTS.smoothing);
    setPalette(DEFAULTS.palette);
    setNodeLife(DEFAULTS.nodeLife);
    setNodeDensity(DEFAULTS.nodeDensity);
    setBloomStrength(DEFAULTS.bloomStrength);
    setOrbitSpeed(DEFAULTS.orbitSpeed);
    setConnectionDist(DEFAULTS.connectionDist);
    setManifoldScale(DEFAULTS.manifoldScale);
    setHighPassFreq(DEFAULTS.highPassFreq);
    setLowPassFreq(DEFAULTS.lowPassFreq);
    setNoiseGate(DEFAULTS.noiseGate);
    setEqBands(DEFAULTS.eqBands);
    
    // Reset filters if they exist
    if (highPassNodeRef.current) highPassNodeRef.current.frequency.setTargetAtTime(DEFAULTS.highPassFreq, audioCtxRef.current!.currentTime, 0.05);
    if (lowPassNodeRef.current) lowPassNodeRef.current.frequency.setTargetAtTime(DEFAULTS.lowPassFreq, audioCtxRef.current!.currentTime, 0.05);
    
    if (filterNodesRef.current) {
      Object.keys(DEFAULTS.eqBands).forEach((freq, idx) => {
        const val = DEFAULTS.eqBands[freq as unknown as keyof typeof DEFAULTS.eqBands];
        if (filterNodesRef.current[idx]) {
          filterNodesRef.current[idx].gain.setTargetAtTime(val, audioCtxRef.current!.currentTime, 0.05);
        }
      });
    }
  };

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Background Ripple Ref
  const rippleRef = useRef<HTMLDivElement>(null);

  // Palettes Definition
  const PALETTES: Record<string, { low: [number, number, number], high: [number, number, number] }> = {
    Spectral: { low: [0.66, 1.0, 0.6], high: [0.0, 1.0, 0.6] }, 
    Sunset: { low: [0.85, 0.9, 0.5], high: [0.02, 1.0, 0.6] },   
    Cyborg: { low: [0.55, 1.0, 0.5], high: [0.9, 1.0, 0.6] },   
    Forest: { low: [0.35, 0.8, 0.4], high: [0.18, 1.0, 0.6] },   
    Monochrome: { low: [0.6, 0.1, 0.4], high: [0.6, 0, 1.0] } 
  };

  // Three.js Core Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const mainGroupRef = useRef<THREE.Group | null>(null);
  const composerRef = useRef<any>(null);
  
  // Audio & Data Refs
  const analyserRef = useRef<AnalyserNode | null>(null);
  const filterNodesRef = useRef<BiquadFilterNode[]>([]);
  const highPassNodeRef = useRef<BiquadFilterNode | null>(null);
  const lowPassNodeRef = useRef<BiquadFilterNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Generative State Refs
  const nodesRef = useRef<DataNode[]>([]);
  const cursorRef = useRef(new THREE.Vector3(0, 0, 0));
  const linesMeshRef = useRef<THREE.LineSegments | null>(null);

  // Configuration Constants
  const MAX_NODES = 400;
  const MAX_LINES = 10000;

  // Configuration Refs for the Animation Loop
  const configRef = useRef({
    fftSize,
    smoothing,
    palette,
    nodeLife,
    nodeDensity,
    bloomStrength,
    orbitSpeed,
    connectionDist,
    manifoldScale,
    noiseGate
  });

  useEffect(() => {
    configRef.current = { fftSize, smoothing, palette, nodeLife, nodeDensity, bloomStrength, orbitSpeed, connectionDist, manifoldScale, noiseGate };
    
    // Immediate feedback on UI change
    if (mainGroupRef.current) {
      mainGroupRef.current.scale.set(manifoldScale, manifoldScale, manifoldScale);
      // Small pulse on parameter change
      animate(mainGroupRef.current.scale, { x: manifoldScale * 1.05, y: manifoldScale * 1.05, z: manifoldScale * 1.05 }, { duration: 0.1 }).then(() => {
        animate(mainGroupRef.current.scale, { x: manifoldScale, y: manifoldScale, z: manifoldScale }, { duration: 0.2 });
      });
    }

    if (analyserRef.current) {
      analyserRef.current.fftSize = fftSize;
      analyserRef.current.smoothingTimeConstant = smoothing;
    }
    
    if (controlsRef.current) {
      controlsRef.current.autoRotateSpeed = orbitSpeed;
    }
  }, [fftSize, smoothing, palette, nodeLife, nodeDensity, bloomStrength, orbitSpeed, connectionDist, manifoldScale, noiseGate]);

  const initScene = () => {
    if (!containerRef.current || !canvasRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 45); 
    cameraRef.current = camera;

    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    const renderer = new THREE.WebGLRenderer({ 
      antialias: false, // Disabling antialias for performance, bloom will smooth edges
      canvas: canvasRef.current,
      alpha: true,
      preserveDrawingBuffer: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Capped at 1.5 for performance
    rendererRef.current = renderer;

    // Post Processing Setup - Reduced Resolution for Bloom
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), // Half-res bloom buffer
      configRef.current.bloomStrength, 0.4, 0.85
    );
    composer.addPass(bloomPass);
    composerRef.current = { composer, bloomPass };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = configRef.current.orbitSpeed; 
    controlsRef.current = controls;

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);
    mainGroupRef.current = mainGroup;

    // Line Connections Mesh
    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(MAX_LINES * 6);
    const lineColors = new Float32Array(MAX_LINES * 6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    lineGeo.setDrawRange(0, 0);

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    mainGroup.add(lines);
    linesMeshRef.current = lines;

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current || !composerRef.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      
      rendererRef.current.setSize(width, height);
      composerRef.current.composer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  };

  const createNode = (amp: number, freqBin: number, emissionTime: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Color Mapping: Use selected palette
    const p = PALETTES[configRef.current.palette] || PALETTES.Spectral;
    const normalizedFreq = Math.max(0, Math.min(1, (freqBin - 93) / (371 - 93)));
    
    // Lerp HSL values
    const h = p.low[0] + normalizedFreq * (p.high[0] - p.low[0]);
    const s = p.low[1] + normalizedFreq * (p.high[1] - p.low[1]);
    const l = p.low[2] + normalizedFreq * (p.high[2] - p.low[2]);
    const color = new THREE.Color().setHSL(h, s, l);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    
    ctx.fillText(amp.toFixed(4), 128, 80);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '500 16px "JetBrains Mono", monospace';
    ctx.fillText(`T+${emissionTime.toFixed(2)}`, 128, 195);

    ctx.strokeStyle = color.getStyle();
    ctx.lineWidth = 2;
    ctx.strokeRect(110, 110, 36, 36);
    
    ctx.shadowBlur = 15;
    ctx.shadowColor = color.getStyle();
    
    ctx.fillStyle = 'white';
    ctx.fillRect(125, 125, 6, 6);
    ctx.shadowBlur = 0;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    
    const spriteMat = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true, 
      blending: THREE.AdditiveBlending,
      depthTest: false 
    });
    
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(4.5, 4.5, 1);
    
    sprite.position.copy(cursorRef.current);
    mainGroupRef.current?.add(sprite);

    return {
      obj: sprite,
      birth: Date.now(),
      emissionTime,
      freq: freqBin,
      amp,
      color,
      canvas,
      ctx,
      texture,
      lastLifetimeUpdate: 0
    };
  };

  const updateNodeCanvas = (node: DataNode, lifetime: number) => {
    // Optimization: Stop updating labels after 3 seconds of life
    if (lifetime > 3.0) return;
    
    if (Math.abs(lifetime - node.lastLifetimeUpdate) < 0.2) return;
    
    const { ctx, texture } = node;
    ctx.clearRect(0, 100, 95, 50); 
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(lifetime.toFixed(2), 95, 136);
    
    texture.needsUpdate = true;
    node.lastLifetimeUpdate = lifetime;
  };

  const updateConnections = () => {
    if (!linesMeshRef.current) return;
    
    const nodes = nodesRef.current;
    const count = nodes.length;
    const positions = linesMeshRef.current.geometry.attributes.position.array as Float32Array;
    const colors = linesMeshRef.current.geometry.attributes.color.array as Float32Array;
    
    let lineIdx = 0;
    const maxDistSq = configRef.current.connectionDist * configRef.current.connectionDist;

    for (let i = 0; i < count; i++) {
      const nodeA = nodes[i];
      const posA = nodeA.obj.position;

      // Local Sequential Connections (Timeline)
      if (i > 0) {
        addConnection(nodeA, nodes[i-1], positions, colors, lineIdx);
        lineIdx += 6;
      }

      // Proximity Connections
      // Complexity reduction: Only check a subset of nodes if the total count is high
      const step = count > 150 ? 2 : 1; 
      
      for (let j = i + 2; j < count; j += step) {
        if (lineIdx / 6 >= MAX_LINES) break;

        const nodeB = nodes[j];
        const distSq = posA.distanceToSquared(nodeB.obj.position);
        
        if (distSq < maxDistSq) {
          addConnection(nodeA, nodeB, positions, colors, lineIdx);
          lineIdx += 6;
        }
      }
    }

    linesMeshRef.current.geometry.setDrawRange(0, lineIdx / 3);
    linesMeshRef.current.geometry.attributes.position.needsUpdate = true;
    linesMeshRef.current.geometry.attributes.color.needsUpdate = true;
  };

  const addConnection = (n1: DataNode, n2: DataNode, pos: Float32Array, col: Float32Array, idx: number) => {
    pos[idx+0] = n1.obj.position.x; pos[idx+1] = n1.obj.position.y; pos[idx+2] = n1.obj.position.z;
    pos[idx+3] = n2.obj.position.x; pos[idx+4] = n2.obj.position.y; pos[idx+5] = n2.obj.position.z;

    col[idx+0] = n1.color.r; col[idx+1] = n1.color.g; col[idx+2] = n1.color.b;
    col[idx+3] = n2.color.r; col[idx+4] = n2.color.g; col[idx+5] = n2.color.b;
  };

  useEffect(() => {
    let animationFrameId: number;
    let lastConnectionUpdate = 0;
    let peakDetected = false;
    
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (!analyserRef.current || !dataArrayRef.current || !sceneRef.current || !cameraRef.current || !rendererRef.current || !composerRef.current) return;

      const timeNow = Date.now();
      const runTime = (timeNow - startTimeRef.current) / 1000.0;

      analyserRef.current.getByteFrequencyData(dataArrayRef.current);
      
      // Apply Noise Gate
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        if (dataArrayRef.current[i] < configRef.current.noiseGate) {
          dataArrayRef.current[i] = 0;
        }
      }

      const minBin = 10;  
      const maxBin = 700; 
      let maxAmp = 0;
      let targetBin = 0;

      for (let i = minBin; i <= maxBin; i++) {
        if (dataArrayRef.current[i] > maxAmp) {
          maxAmp = dataArrayRef.current[i];
          targetBin = i;
        }
      }

      const normalizedAmp = maxAmp / 255.0;

      // Update HUD and background ripple - Throttled to ~15fps for UI elements
      if (timeNow % 64 < 16) {
        if (timeDisplayRef.current) timeDisplayRef.current.innerText = runTime.toFixed(2);
        if (ampDisplayRef.current) ampDisplayRef.current.innerText = normalizedAmp.toFixed(4);
      }
      
      if (spectralBarRef.current) {
        spectralBarRef.current.style.width = `${normalizedAmp * 100}%`;
      }

      // Background ripple on peak detection
      if (normalizedAmp > 0.4 && !peakDetected) {
        peakDetected = true;
        if (rippleRef.current) {
          rippleRef.current.style.transform = 'translate(-50%, -50%) scale(2)';
          rippleRef.current.style.opacity = '1';
          setTimeout(() => {
            if (rippleRef.current) {
               rippleRef.current.style.transform = 'translate(-50%, -50%) scale(3)';
               rippleRef.current.style.opacity = '0';
            }
          }, 300);
        }
        
        // Intelligent Rating Request hook (triggers on 100th "peak" experienced)
        happyPathCountRef.current++;
        if (happyPathCountRef.current === 100) {
           const hasRated = localStorage.getItem('pickko-has-rated');
           if (!hasRated && !showRatingPrompt) {
               setShowRatingPrompt(true);
           }
        }
      } else if (normalizedAmp < 0.2) {
        peakDetected = false;
      }

      // Update Bloom specifically
      composerRef.current.bloomPass.strength = configRef.current.bloomStrength * (0.8 + normalizedAmp * 0.4);

      if (normalizedAmp > 0.05) {
        const freqNorm = (targetBin - minBin) / (maxBin - minBin);
        
        const x = Math.sin(runTime * 1.8) * 12 + (freqNorm - 0.5) * 20;
        const y = Math.cos(runTime * 1.2) * 12 + (normalizedAmp * 15) - 5;
        const z = Math.sin(runTime * 0.7) * 15;

        cursorRef.current.lerp(new THREE.Vector3(x, y, z), 0.15);

        if (nodesRef.current.length === 0 || (timeNow - nodesRef.current[nodesRef.current.length - 1].birth) > configRef.current.nodeDensity) {
          nodesRef.current.push(createNode(normalizedAmp, targetBin, runTime));
        }
      }

      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const node = nodesRef.current[i];
        const lifetime = (timeNow - node.birth) / 1000.0;
        
        updateNodeCanvas(node, lifetime);

        if (lifetime > configRef.current.nodeLife || nodesRef.current.length > MAX_NODES) {
          mainGroupRef.current?.remove(node.obj);
          node.texture.dispose();
          node.obj.material.dispose();
          nodesRef.current.splice(i, 1);
        }
      }

      // Performance Optimization: Update connections every 50ms (20fps)
      if (timeNow - lastConnectionUpdate > 50) {
        updateConnections();
        lastConnectionUpdate = timeNow;
      }

      if (controlsRef.current) controlsRef.current.update();
      composerRef.current.composer.render();
    };

    if (isInitialized) {
      animate();
    }
    
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isInitialized]);

  const initializeAudio = async () => {
    try {
      setAudioError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      audioStreamRef.current = stream;
      setupAudioPipeline(stream);
      happyPathCountRef.current += 1;
    } catch (err: any) {
      const isNative = Capacitor.isNativePlatform();
      setAudioError(isNative 
        ? "Microphone access was denied. Please allow it in App Settings (Permissions > Microphone)." 
        : "Microphone access was denied. Please allow it in site settings.");
      setIsInitialized(false);
    }
  };

  const handleSupportLink = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const url = "https://www.supportkori.com/mdzobaedislamshanto";
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
    }
  };

  const setupAudioPipeline = async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      
      analyser.fftSize = fftSize; 
      analyser.smoothingTimeConstant = smoothing; 
      
      const highPassNode = audioCtx.createBiquadFilter();
      highPassNode.type = 'highpass';
      highPassNode.frequency.value = highPassFreq;
      highPassNode.Q.value = 0.707;
      highPassNodeRef.current = highPassNode;
      
      const lowPassNode = audioCtx.createBiquadFilter();
      lowPassNode.type = 'lowpass';
      lowPassNode.frequency.value = lowPassFreq;
      lowPassNode.Q.value = 0.707;
      lowPassNodeRef.current = lowPassNode;

      // Dynamics Compressor to boost quiet birds and tame loud ones
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, audioCtx.currentTime);
      compressor.knee.setValueAtTime(40, audioCtx.currentTime);
      compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
      compressor.attack.setValueAtTime(0, audioCtx.currentTime);
      compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

      const freqs = Object.keys(eqBands).map(Number);
      const filters = freqs.map((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.0;
        filter.gain.value = eqBands[freq as keyof typeof eqBands];
        return filter;
      });

      filterNodesRef.current = filters;

      // Connect source -> compressor (pre-amp) -> highPass -> lowPass -> EQ -> analyser
      source.connect(compressor);
      compressor.connect(highPassNode);
      highPassNode.connect(lowPassNode);
      
      let lastNode: AudioNode = lowPassNode;
      filters.forEach(filter => {
        lastNode.connect(filter);
        lastNode = filter;
      });
      lastNode.connect(analyser);
      
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = audioCtx;
      startTimeRef.current = Date.now();
      
      setAudioError(null);
      setIsInitialized(true);
      initScene();
    } catch (err: any) {
      // Production silent
      setAudioError('Audio processing failed to initialize.');
    }
  };

  const updateEqBand = (freq: number, gain: number) => {
    const idx = Object.keys(eqBands).indexOf(freq.toString());
    if (idx !== -1 && filterNodesRef.current[idx] && audioCtxRef.current) {
      filterNodesRef.current[idx].gain.setTargetAtTime(gain, audioCtxRef.current.currentTime, 0.05);
    }
    setEqBands(prev => ({ ...prev, [freq]: gain }));
  };

  const updateHighPass = (freq: number) => {
    if (highPassNodeRef.current && audioCtxRef.current) {
      highPassNodeRef.current.frequency.setTargetAtTime(freq, audioCtxRef.current.currentTime, 0.05);
    }
    setHighPassFreq(freq);
  };

  const updateLowPass = (freq: number) => {
    if (lowPassNodeRef.current && audioCtxRef.current) {
      lowPassNodeRef.current.frequency.setTargetAtTime(freq, audioCtxRef.current.currentTime, 0.05);
    }
    setLowPassFreq(freq);
  };

  const startRecording = () => {
    if (!canvasRef.current || !audioStreamRef.current) return;
    try {
      chunksRef.current = [];
      const canvasStream = canvasRef.current.captureStream(60);
      const tracks = [
        ...canvasStream.getVideoTracks(),
        ...audioStreamRef.current.getAudioTracks()
      ];
      const combinedStream = new MediaStream(tracks);
      
      // Fallback MIME types for cross-browser support
      let options = { mimeType: 'video/webm;codecs=vp9' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: 'video/mp4' };
        }
      }
      
      const recorder = new MediaRecorder(combinedStream, options);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
      };
      
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      // Fallback UI indication if needed
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleDownload = async () => {
    if (!videoUrl) return;
    
    if (Capacitor.isNativePlatform()) {
      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        
        // Convert blob to base64 for native writing
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          
          try {
            const fileName = `birdsong-${Date.now()}.webm`;
            const result = await Filesystem.writeFile({
              path: fileName,
              data: base64data,
              directory: Directory.Cache
            });
            
            await Share.share({
              title: 'Birdsong Visualization',
              text: 'Check out this visualization from Birdsong Visualizer!',
              url: result.uri,
            });
          } catch (writeErr) {
            // Production silent
          }
        };
      } catch (err) {
        // Production silent
      }
    } else {
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = 'birdsong-visualizer.webm';
      link.click();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden flex flex-col font-sans select-none">
      <canvas id="visualizer-canvas" ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      
      {/* Visual background atmospheric hint */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,rgba(15,15,20,0.4)_0%,transparent_70%)]" />

      {/* Dynamic Background Ripple */}
      <div 
        ref={rippleRef}
        className="absolute top-1/2 left-1/2 w-[500px] h-[500px] -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-full border border-white/5 opacity-0 transition-all duration-700 ease-out z-0"
        style={{ transform: 'translate(-50%, -50%) scale(1)' }}
      />

      <AnimatePresence>
        {showRatingPrompt && <RatingPrompt onClose={() => setShowRatingPrompt(false)} onRate={handleRateApp} />}
      </AnimatePresence>

      <AnimatePresence>
        {!isInitialized && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <div className="text-center flex flex-col items-center p-6">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
              >
                <img src="/logo.png" className="w-24 h-24 sm:w-32 sm:h-32 mb-8 object-contain" alt="Logo" />
              </motion.div>
              
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.8 }}
                className="flex flex-col items-center mb-10"
              >
                <h2 className="text-4xl sm:text-6xl font-light tracking-[0.05em] text-white mb-2 uppercase text-center leading-tight">
                  Birdsong<br/>
                  <span className="font-extralight tracking-[0.2em] opacity-60 text-2xl sm:text-4xl">Visualizer</span>
                </h2>
                <div className="h-px w-12 bg-white/20 mt-4 mb-4" />
                <div className="text-[10px] tracking-[0.3em] text-white/40 uppercase italic">The Shape of Song</div>
              </motion.div>

              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="text-lg sm:text-xl tracking-[0.1em] text-white/70 font-extralight mb-12 uppercase text-center max-w-lg leading-relaxed"
              >
                Experience the geometry of birdsong
              </motion.h1>
              
              <motion.button 
                onClick={handleSupportLink}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="text-[9px] text-white/20 tracking-[0.4em] mb-12 uppercase font-medium text-center hover:text-white/50 transition-colors cursor-pointer pointer-events-auto"
              >
                Made with love by Pickko
              </motion.button>
              
              <motion.button 
                id="init-audio-btn"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.08)" }}
                whileTap={{ scale: 0.98 }}
                onClick={initializeAudio}
                className="px-8 sm:px-12 py-3 sm:py-5 glass-pill text-white/80 uppercase tracking-[0.25em] text-[10px] font-semibold transition-all cursor-pointer hover:text-white border border-white/10"
              >
                Step into the Resonance
              </motion.button>
              
              {audioError && (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                   className="mt-6 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
                 >
                    <Info size={14} className="text-red-400" />
                    <span className="text-[10px] text-red-200/90 font-mono">{audioError}</span>
                 </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <AnimatePresence>
        {isInitialized && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            transition={{ delay: 0.8, duration: 1.5, ease: "easeOut" }}
            className="absolute inset-x-0 inset-y-0 pointer-events-none z-10 p-6 sm:p-10 flex flex-col justify-between safe-padding-top safe-padding-bottom"
          >
            {/* Top Bar Indicators */}
            <div className="flex justify-between items-start w-full relative">
              <div className="flex flex-col gap-3 sm:gap-4">
                <div className="glass-pill px-4 sm:px-5 py-1.5 sm:py-2 flex items-center gap-2.5 w-fit">
                   <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                   <span className="text-[8px] sm:text-[10px] uppercase tracking-[0.2em] font-bold text-white/80">The Song is Breathing</span>
                </div>
                
                <div className="glass px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl flex flex-col gap-1 w-32 sm:w-48">
                   <div className="flex justify-between items-center text-[8px] sm:text-[9px] uppercase tracking-widest text-white/40 font-bold mb-1">
                      <span className="hidden sm:inline">Harmonic Presence</span>
                      <span className="sm:hidden">Density</span>
                      <span ref={ampDisplayRef} className="text-white/70 text-[10px] sm:text-xs">0.0000</span>
                   </div>
                   <div className="h-0.5 sm:h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <div 
                        ref={spectralBarRef}
                        className="h-full bg-white/40 transition-[width] duration-75 ease-out"
                        style={{ width: "0%" }}
                      />
                   </div>
                </div>
              </div>

              <div className="flex items-start gap-4 sm:gap-8 pointer-events-auto">
                <div className="flex gap-2">
                  {videoUrl && !isRecording && (
                    <motion.button
                      onClick={handleDownload}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="glass-pill p-2 sm:p-3 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      <Download size={18} />
                    </motion.button>
                  )}
                  {showInstallBtn && (
                    <motion.button
                      onClick={handleInstallClick}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="glass-pill p-2 sm:p-3 text-green-400 hover:text-green-300 transition-colors cursor-pointer"
                      title="Install as Software"
                    >
                      <Activity size={18} />
                    </motion.button>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.1)" }}
                    whileTap={{ scale: 0.95 }}
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`glass-pill p-2 sm:p-3 transition-colors cursor-pointer ${isRecording ? 'text-red-500 animate-pulse border-red-500/50' : 'text-white/60 hover:text-white'}`}
                  >
                    {isRecording ? <RotateCcw size={18} /> : <Video size={18} />}
                  </motion.button>
                </div>

                <motion.button
                  whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.1)" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowControls(!showControls)}
                  className="glass-pill p-2 sm:p-3 text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  {showControls ? <X size={18} /> : <Settings size={18} />}
                </motion.button>

                <div className="hidden sm:flex flex-col gap-2 text-right">
                  <button 
                    onClick={handleSupportLink}
                    className="text-[10px] font-mono text-white/40 tracking-wider uppercase hover:text-white/70 transition-colors cursor-pointer pointer-events-auto text-right"
                  >
                    Made with love by Pickko
                  </button>
                  <div className="text-2xl font-mono text-white/90 font-light tracking-tighter">
                     T+<span ref={timeDisplayRef}>0.00</span>
                  </div>
                </div>
              </div>

              {/* Settings Panel */}
              <AnimatePresence>
                {showControls && (
                  <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    className="absolute top-16 sm:top-20 right-0 w-full sm:w-96 glass-card p-4 sm:p-6 z-50 pointer-events-auto h-[80vh] flex flex-col"
                  >
                    <div className="flex gap-2 mb-6 border-b border-white/5 pb-2">
                       <button 
                         onClick={() => setActiveTab('essence')}
                         className={`flex-1 py-2 text-[9px] uppercase tracking-widest font-bold transition-all ${activeTab === 'essence' ? 'text-white border-b border-white' : 'text-white/30 hover:text-white/50'}`}
                       >
                         Essence
                       </button>
                       <button 
                         onClick={() => setActiveTab('resonance')}
                         className={`flex-1 py-2 text-[9px] uppercase tracking-widest font-bold transition-all ${activeTab === 'resonance' ? 'text-white border-b border-white' : 'text-white/30 hover:text-white/50'}`}
                       >
                         Resonance
                       </button>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                      {activeTab === 'essence' ? (
                        <div className="flex flex-col gap-5 sm:gap-6">
                          <div className="flex flex-col gap-3">
                            <label className="text-[9px] sm:text-[10px] uppercase tracking-widest text-white/40 font-bold">Ethereal Palette</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {Object.keys(PALETTES).map(p => (
                                <button
                                  key={p}
                                  onClick={() => setPalette(p)}
                                  className={`px-3 py-2 text-[10px] text-center rounded-lg transition-all ${palette === p ? 'bg-white/10 text-white border border-white/20' : 'text-white/40 hover:bg-white/5 border border-transparent'}`}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Gentleness</span>
                                <span className="text-white/80">{smoothing.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="0.95" step="0.01" 
                                value={smoothing} onChange={(e) => setSmoothing(parseFloat(e.target.value))}
                                className="w-full"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Glow</span>
                                <span className="text-white/80">{bloomStrength.toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="3" step="0.1" 
                                value={bloomStrength} onChange={(e) => setBloomStrength(parseFloat(e.target.value))}
                                className="w-full"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Circle of Life</span>
                                <span className="text-white/80">{orbitSpeed.toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="5" step="0.1" 
                                value={orbitSpeed} onChange={(e) => setOrbitSpeed(parseFloat(e.target.value))}
                                className="w-full"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Connections</span>
                                <span className="text-white/80">{connectionDist.toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="1" max="10" step="0.1" 
                                value={connectionDist} onChange={(e) => setConnectionDist(parseFloat(e.target.value))}
                                className="w-full"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Presence</span>
                                <span className="text-white/80">{nodeDensity}</span>
                              </div>
                              <input 
                                type="range" min="10" max="250" step="5" 
                                value={nodeDensity} onChange={(e) => setNodeDensity(parseInt(e.target.value))}
                                className="w-full"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Infinite Scale</span>
                                <span className="text-white/80">{manifoldScale.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="0.5" max="2.5" step="0.05" 
                                value={manifoldScale} onChange={(e) => setManifoldScale(parseFloat(e.target.value))}
                                className="w-full"
                              />
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                            <label className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Spiritual Depth</label>
                            <div className="flex gap-2">
                              {[1024, 2048, 4096].map(size => (
                                <button
                                  key={size}
                                  onClick={() => setFftSize(size)}
                                  className={`flex-1 py-2 text-[10px] rounded-lg transition-all ${fftSize === size ? 'bg-white/20 text-white font-bold border border-white/30' : 'text-white/30 bg-white/5 border border-transparent'}`}
                                >
                                  {size}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col h-full">
                          <p className="text-[10px] text-white/40 mb-8 italic text-center px-4 leading-relaxed tracking-wide">
                            "Isolate the song from the silence. Tune the resonance to find where Pickko used to sing."
                          </p>
                          
                          <div className="flex-1 flex flex-col gap-6 px-1 mb-8 overflow-y-auto custom-scrollbar">
                            <div className="flex flex-col gap-3 pt-2">
                              <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
                                <span>Spectral Silence (Noise Gate)</span>
                                <span className="text-white/80">{noiseGate}</span>
                              </div>
                              <input 
                                type="range" min="0" max="255" step="1" 
                                value={noiseGate} onChange={(e) => setNoiseGate(parseInt(e.target.value))}
                                className="w-full"
                              />
                              <p className="text-[8px] text-white/20 uppercase tracking-tighter text-center">Increase to ignore background hum</p>
                            </div>
                            
                            <div className="flex justify-between items-end h-48 sm:h-56 gap-1 sm:gap-2 px-1">
                              {Object.entries(eqBands).map(([freq, gain]) => (
                                 <div key={freq} className="flex-1 flex flex-col items-center gap-3 h-full">
                                    <div className="relative w-full flex-1 flex justify-center bg-white/5 rounded-full group">
                                       <input 
                                         type="range" min="-24" max="24" step="1"
                                         value={gain as number}
                                         style={{ WebkitAppearance: 'slider-vertical' } as any}
                                         onChange={(e) => updateEqBand(Number(freq), parseFloat(e.target.value))}
                                         className="vertical-slider w-1.5 h-full appearance-none bg-transparent cursor-pointer"
                                       />
                                       <div 
                                         className="absolute bottom-0 left-0 right-0 bg-white/10 rounded-full transition-all duration-200 pointer-events-none"
                                         style={{ height: `${(((gain as number) + 24) / 48) * 100}%` }}
                                       />
                                    </div>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] text-white/60 font-mono tracking-tighter">
                                        {parseInt(freq) >= 1000 ? `${parseInt(freq)/1000}k` : freq}
                                      </span>
                                    </div>
                                 </div>
                              ))}
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mt-auto mb-2">
                            <button 
                              onClick={() => {
                                const birdPresets = { 60: -24, 170: -24, 310: -24, 600: -24, 1000: -12, 3000: 24, 6000: 24, 12000: -15, 14000: -24, 16000: -24 };
                                Object.entries(birdPresets).forEach(([f, g]) => updateEqBand(Number(f), g));
                              }}
                              className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[9px] uppercase tracking-widest text-white/60 hover:text-white transition-all font-bold"
                            >
                              Strict Song Pureness
                            </button>
                            <button 
                              onClick={() => {
                                Object.keys(eqBands).forEach(f => updateEqBand(Number(f), 0));
                              }}
                              className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[9px] uppercase tracking-widest text-white/60 hover:text-white transition-all font-bold"
                            >
                              Flat Space
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
                      <button
                        onClick={resetToDefaults}
                        className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-[10px] uppercase tracking-[0.2em] font-bold transition-all flex items-center justify-center gap-2"
                      >
                        <RotateCcw size={14} />
                        Return to Essence
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Section */}
            <div className="flex flex-col sm:flex-row justify-between items-center sm:items-end w-full gap-8 sm:gap-0">
              {/* Left spacer to keep center block aligned on desktop */}
              <div className="hidden sm:block w-48" />

              {/* Central Identity */}
              <div className="flex flex-col items-center mb-0 sm:mb-4 px-4 order-first sm:order-none">
                <div className="text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.3em] sm:tracking-[0.5em] text-white/20 mb-2">Soul Reflected</div>
                <h2 className="text-xl sm:text-3xl font-serif italic text-white/95 text-center leading-tight">
                   Echoes of the Sky
                </h2>
                <div className="flex sm:hidden mt-4 font-mono text-[9px] uppercase tracking-widest text-white/30 gap-4">
                  <span>T+<span ref={timeDisplayRef}>0.00</span></span>
                </div>
              </div>

              {/* Right Side Spectrum Capsule - Optimized for mobile */}
              <div className="flex flex-row sm:flex-col items-center gap-6 mb-2 sm:mb-4 w-full sm:w-auto px-4 sm:px-0">
                <div className="hidden sm:flex glass-pill w-12 py-6 flex flex-col items-center justify-between h-64">
                   <div className="text-[9px] font-mono text-white/40 origin-center -rotate-90 whitespace-nowrap mb-2 transition-colors duration-200">High Pass</div>
                   <div className="flex-1 w-full max-h-[120px] flex flex-row items-center justify-center gap-1 my-4 relative">
                      <div className="absolute inset-0 flex justify-center pointer-events-none">
                         <div className="w-px h-full bg-white/10" />
                      </div>
                      <input 
                        title="High Pass Frequency"
                        type="range" min="20" max="20000" step="10"
                        value={highPassFreq}
                        onChange={(e) => updateHighPass(Number(e.target.value))}
                        className="vertical-slider w-1 h-full appearance-none bg-transparent cursor-pointer relative z-10"
                        style={{ WebkitAppearance: 'slider-vertical' } as any}
                      />
                      <input 
                        title="Low Pass Frequency"
                        type="range" min="20" max="20000" step="10"
                        value={lowPassFreq}
                        onChange={(e) => updateLowPass(Number(e.target.value))}
                        className="vertical-slider w-1 h-full appearance-none bg-transparent cursor-pointer relative z-10"
                        style={{ WebkitAppearance: 'slider-vertical' } as any}
                      />
                   </div>
                   <div className="text-[9px] font-mono text-white/40 origin-center -rotate-90 whitespace-nowrap mt-2 transition-colors duration-200">Low Pass</div>
                </div>
                <div className="sm:hidden flex-1 w-full flex flex-col gap-2 relative z-10 px-4">
                   <div className="flex items-center gap-2">
                       <span className="text-[9px] font-mono text-white/40 min-w-[50px]">High Pass</span>
                       <input 
                         title="High Pass Frequency"
                         type="range" min="20" max="20000" step="10"
                         value={highPassFreq}
                         onChange={(e) => updateHighPass(Number(e.target.value))}
                         className="w-full appearance-none h-0.5 bg-white/10 outline-none block opacity-70 hover:opacity-100"
                       />
                   </div>
                   <div className="flex items-center gap-2">
                       <span className="text-[9px] font-mono text-white/40 min-w-[50px]">Low Pass</span>
                       <input 
                         title="Low Pass Frequency"
                         type="range" min="20" max="20000" step="10"
                         value={lowPassFreq}
                         onChange={(e) => updateLowPass(Number(e.target.value))}
                         className="w-full appearance-none h-0.5 bg-white/10 outline-none block opacity-70 hover:opacity-100"
                       />
                   </div>
                </div>
                <div className="text-[9px] font-mono text-white/40 tracking-widest uppercase">The Frequency of Life</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
