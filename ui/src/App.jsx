import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import Pokedex from "./pages/Pokedex";
import PokemonDetail from "./pages/PokemonDetail";
import TypeChart from "./pages/TypeChart";
import MoveBrowser from "./pages/MoveBrowser";
import TeamBuilder from "./pages/TeamBuilder";
import logo from "./assets/logo.png";
import "./App.css";

const NAV_LINKS = [
  { to: "/pokedex",      label: "Pokédex" },
  { to: "/types",        label: "Type Chart" },
  { to: "/moves",        label: "Moves" },
  { to: "/team-builder", label: "Team Builder" },
];

function NavLinks({ onClick }) {
  return NAV_LINKS.map(({ to, label }) => (
    <NavLink
      key={to}
      to={to}
      className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}
      onClick={onClick}
    >
      {label}
    </NavLink>
  ));
}

// Closes the drawer whenever the route changes (e.g. after tapping a link).
function RouteWatcher({ onRouteChange }) {
  const location = useLocation();
  useEffect(() => { onRouteChange(); }, [location.pathname]);
  return null;
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const close = () => setDrawerOpen(false);

  return (
    <HashRouter>
      <RouteWatcher onRouteChange={close} />
      <div className="app">
        <header className="app-header">
          <img src={logo} alt="PokéLocal" className="app-logo" />

          {/* Desktop nav */}
          <nav className="app-nav app-nav--desktop">
            <NavLinks />
          </nav>

          {/* Hamburger — mobile only */}
          <button
            className="app-hamburger"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <span /><span /><span />
          </button>
        </header>

        {/* Mobile side drawer */}
        {drawerOpen && <div className="app-drawer-backdrop" onClick={close} />}
        <nav className={`app-drawer${drawerOpen ? " app-drawer--open" : ""}`} aria-hidden={!drawerOpen}>
          <div className="app-drawer-header">
            <img src={logo} alt="PokéLocal" className="app-logo" />
            <button className="app-drawer-close" onClick={close} aria-label="Close navigation">✕</button>
          </div>
          <div className="app-drawer-links">
            <NavLinks onClick={close} />
          </div>
        </nav>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/pokedex" replace />} />
            <Route path="/pokedex" element={<Pokedex />} />
            <Route path="/pokemon/:id" element={<PokemonDetail />} />
            <Route path="/types" element={<TypeChart />} />
            <Route path="/moves" element={<MoveBrowser />} />
            <Route path="/team-builder" element={<TeamBuilder />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
