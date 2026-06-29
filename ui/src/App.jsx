import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import Pokedex from "./pages/Pokedex";
import PokemonDetail from "./pages/PokemonDetail";
import TypeChart from "./pages/TypeChart";
import MoveBrowser from "./pages/MoveBrowser";
import TeamBuilder from "./pages/TeamBuilder";
import ChampionsUsage from "./pages/ChampionsUsage";
import ChampionsTeamBuilder from "./pages/ChampionsTeamBuilder";
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

function ChampionsDropdown({ onLinkClick }) {
  const location = useLocation();
  const isActive = location.pathname.startsWith("/champions");
  return (
    <div className="nav-dropdown">
      <button
        className={`nav-link nav-dropdown__trigger${isActive ? " active" : ""}`}
        aria-haspopup="true"
      >
        Champions <span className="nav-dropdown__chevron" aria-hidden="true">▾</span>
      </button>
      <div className="nav-dropdown__menu" role="menu">
        <NavLink
          to="/champions/usage"
          className={({ isActive }) => `nav-dropdown__item${isActive ? " active" : ""}`}
          onClick={onLinkClick}
          role="menuitem"
        >Usage Data</NavLink>
        <NavLink
          to="/champions/team-builder"
          className={({ isActive }) => `nav-dropdown__item${isActive ? " active" : ""}`}
          onClick={onLinkClick}
          role="menuitem"
        >Team Builder</NavLink>
      </div>
    </div>
  );
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
            <ChampionsDropdown onLinkClick={close} />
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
            <div className="app-drawer-section">
              <span className="app-drawer-section__label">Champions</span>
              <NavLink
                to="/champions/usage"
                className={({ isActive }) => `nav-link nav-link--indent${isActive ? " active" : ""}`}
                onClick={close}
              >Usage Data</NavLink>
              <NavLink
                to="/champions/team-builder"
                className={({ isActive }) => `nav-link nav-link--indent${isActive ? " active" : ""}`}
                onClick={close}
              >Team Builder</NavLink>
            </div>
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
            <Route path="/champions" element={<Navigate to="/champions/usage" replace />} />
            <Route path="/champions/usage" element={<ChampionsUsage />} />
            <Route path="/champions/team-builder" element={<ChampionsTeamBuilder />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
