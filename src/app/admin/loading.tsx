import './admin.css';

/** The admin area's own loading state (the root one draws the election panel). */
export default function AdminLoading() {
  return (
    <div className="admin">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-mark" aria-hidden="true">
            RB
          </span>
          <div>
            <h1>Administração</h1>
            <p>Resultados Brasil</p>
          </div>
        </div>
      </header>
      <main className="admin-main">
        <p className="admin-empty" role="status">
          Carregando a administração…
        </p>
      </main>
    </div>
  );
}
