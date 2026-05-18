export function createUiHelpers({ feedbackNode, currentLocale }) {
  function showFeedback(message) {
    feedbackNode.textContent = message;
    feedbackNode.classList.remove("hidden");
    window.setTimeout(() => feedbackNode.classList.add("hidden"), 2200);
  }

  function euro(value) {
    return new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function euroFromCents(value) {
    return new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0) / 100);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function safeJsonFetch(url, fallbackUrl, options) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (!fallbackUrl) throw error;
      const response = await fetch(fallbackUrl, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }
  }

  return {
    showFeedback,
    euro,
    euroFromCents,
    escapeHtml,
    safeJsonFetch
  };
}
