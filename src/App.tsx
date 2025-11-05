import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter as Router } from "react-router-dom";
import Content, { NavBar } from './routes'
import store from './redux';
import './App.css';

// store.dispatch(load());

function App() {
  useEffect(() => {
    // lazy import to avoid circular deps on hooks; dispatch me() via store directly
    import('./redux/auth').then(({ me }) => {
      store.dispatch<any>(me())
    })
  }, [])
  return (
    <Provider store={store}>
      <Router>
        <div className="sjs-app">
          <header className="sjs-app__header">
            <div className="sjs-app__header-inner">
              <NavBar/>
            </div>
          </header>
          <main className="sjs-app__content">
            <Content/>
          </main>
          <footer className="sjs-app__footer">
            <div className="sjs-app__footer-inner">
              <span>Copyright © {new Date().getFullYear()} Devsoft Baltic OÜ. All rights reserved.</span>
            </div>
          </footer>
        </div>
      </Router>
    </Provider>
  );
}

export default App;
