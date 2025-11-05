import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
// Axios is used for API calls; enable credentials for session cookies
import axios from 'axios';

// Optionally enable MSW (mock service worker) in development or when explicitly requested
async function enableMocking() {
  const enableMsw = process.env.REACT_APP_ENABLE_MSW === 'true' || process.env.NODE_ENV === 'development'
  if (!enableMsw) {
    return;
  }

  const { worker } = await import("./mocks/browser")

  return worker.start();
}

enableMocking().then(() => {
  // Send cookies with cross-origin requests (frontend 3000 -> backend 8080)
  axios.defaults.withCredentials = true;
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
