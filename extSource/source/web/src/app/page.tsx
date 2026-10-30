import { Dashboard } from "@/components/Dashboard";

export default function HomePage() {
  return (
    <main>
      <a className="skip-link" href="#profile-workspace">Skip to profile workspace</a>
      <header className="app-header">
        <div>
          <h1>MAHID <span>2.0</span></h1>
          <p>Business Profile Dashboard</p>
        </div>
      </header>
      <div id="profile-workspace"><Dashboard /></div>
    </main>
  );
}
