import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter as Router, useLocation } from "react-router-dom";
import Content, { NavBar } from './routes'
import store, { useReduxSelector } from './redux';
import Chatbot from './components/Chatbot';
import OnboardingModal from './components/OnboardingModal';
import './App.css';

// Component to conditionally show header
const AppContent = () => {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const user = useReduxSelector(state => state.auth.user);
  const isLoggedIn = !!user;
  const isStudent = isLoggedIn && user?.role !== 'admin';

  return (
    <div className="sjs-app">
      {!isAuthPage && (
        <header className="sjs-app__header">
          <div className="sjs-app__header-inner">
            <NavBar />
          </div>
        </header>
      )}
      <main className={`sjs-app__content ${isAuthPage ? 'sjs-app__content--auth' : ''}`}>
        <Content />
      </main>
      {/* Chatbot only for logged-in students */}
      {isStudent && <Chatbot isLoggedIn={isStudent} />}
      {/* First-login onboarding modal — shown until student marks complete */}
      {isStudent && <OnboardingModal />}
    </div>
  );
};

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
        <AppContent />
      </Router>
    </Provider>
  );
}

export default App;
