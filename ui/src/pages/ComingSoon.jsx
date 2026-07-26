import wipPikachu from "../assets/wip_pikachu2.svg";
import "./ComingSoon.css";

export default function ComingSoon() {
  return (
    <div className="cs">
      <img className="cs__img" src={wipPikachu} alt="" />
      <p className="cs__desc">Oops! We're still working on this. Check back later!</p>
    </div>
  );
}
