const cards = ["Design", "Build", "Ship"];

export default function App() {
  return (
    <main className="page">
      <h1>Cards</h1>
      <section className="cards">
        {cards.map(title => (
          <article className="card" key={title}>
            <h2>{title}</h2>
            <p>Short description for {title.toLowerCase()}.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
