import { BrowserRouter, Route, Routes } from "react-router-dom";
import PinWindow from "./components/PinWindow";

function MainDaemon() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
      <div className="text-center">
        <h1 className="mb-2 text-lg font-medium text-slate-200">PinCopy</h1>
        <p className="text-sm">后台运行中 · 双击 Ctrl 将剪贴板文本贴到屏幕</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/pin" element={<PinWindow />} />
        <Route path="*" element={<MainDaemon />} />
      </Routes>
    </BrowserRouter>
  );
}
