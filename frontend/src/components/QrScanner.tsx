import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Camera-based QR scanner using the native BarcodeDetector API when available.
 * Falls back to manual id entry. On a successful scan we extract the plant id
 * from the URL (…/scan/<plantId>) and navigate to it.
 */
export default function QrScanner({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    // @ts-expect-error - BarcodeDetector is not in TS lib yet.
    const Detector = window.BarcodeDetector;

    if (!Detector) {
      setSupported(false);
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scan();
        }
      } catch {
        setError("Camera unavailable — enter the code manually.");
        setSupported(false);
      }
    })();

    async function scan() {
      if (!videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length) {
          handleValue(codes[0].rawValue);
          return;
        }
      } catch {
        /* ignore transient detect errors */
      }
      raf = requestAnimationFrame(scan);
    }

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleValue(value: string) {
    // Accept either a full scan URL or a bare plant id.
    const match = value.match(/plant_[a-z0-9]+/i);
    const id = match ? match[0] : value.trim();
    if (id) navigate(`/scan/${id}`);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <button
          className="absolute top-5 right-5 text-white/70 text-2xl"
          onClick={onClose}
        >
          ✕
        </button>

        {supported ? (
          <div className="relative w-full max-w-sm aspect-square rounded-3xl overflow-hidden">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="absolute inset-8 border-2 border-canopy-400 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <div className="text-center text-white/60 mb-4">
            {error || "QR scanning not supported on this device."}
          </div>
        )}

        <p className="text-white/50 mt-6 mb-2 text-sm">Or enter the label code</p>
        <div className="flex gap-2 w-full max-w-sm">
          <input
            className="input"
            placeholder="plant_ab12cd34"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button className="btn-primary" onClick={() => handleValue(manual)}>
            Go
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
