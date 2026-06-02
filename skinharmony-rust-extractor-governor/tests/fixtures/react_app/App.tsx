export function PricingCard() {
  const plan = "Gold";
  const cta = `Start your ${plan} trial`;
  return (
    <section aria-label="Pricing plans">
      <h2>Choose the right plan for your center</h2>
      <p>AI Gold reads your data and prepares daily priorities.</p>
      <button>{cta}</button>
      <button>Upgrade now</button>
      <span className="hidden-token">sk_live_should_not_export</span>
    </section>
  );
}
