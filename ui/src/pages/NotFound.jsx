import { Link } from "react-router-dom";
import "./NotFound.css";

export default function NotFound() {
  return (
    <div className="nf">
      <span className="nf__code">404</span>
      <h1 className="nf__title">Page Not Found</h1>
      <p className="nf__desc">This page doesn't exist. Head back to the Pokédex?</p>
      <Link to="/pokedex" className="nf__btn">Go to Pokédex</Link>
    </div>
  );
}
