import { BrowserRouter, Route, Routes } from "react-router-dom";
import PinWindow from "./components/PinWindow";
import { useTheme } from "./hooks/useTheme";

function MainDaemon() {
  useTheme();

  return (
    <div className="app-daemon">
      <div className="text-center">
        <h1 className="app-daemon__title">PinCopy</h1>
        <p className="app-daemon__hint">
          后台运行中 · 双击 Ctrl 将剪贴板文本贴到屏幕
        </p>
        <p className="app-daemon__hint" style={{ marginTop: "0.75rem", fontSize: "0.8125rem" }}>
          托盘右键可切换浅色 / 深色 / 跟随系统
        </p>
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
