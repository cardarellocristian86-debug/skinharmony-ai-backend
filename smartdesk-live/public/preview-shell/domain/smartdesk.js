export function createSmartDeskDomainHelpers(deps) {
  const {
    state,
    t,
    currentLanguage,
    riskBandLabel,
    findClientForAppointment
  } = deps;

  function filteredClients() {
    const query = state.clientSearch.trim().toLowerCase();
    if (!query) return state.clients;
    return state.clients.filter((item) =>
      item.name.toLowerCase().includes(query)
      || String(item.phone || "").includes(query)
      || String(item.email || "").toLowerCase().includes(query)
    );
  }

  function clientAppointments(client) {
    if (!client) return [];
    return state.appointments
      .filter((item) => item.clientId === client.id || item.client === client.name)
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
  }

  function clientPayments(client) {
    if (!client) return [];
    return (state.sales || [])
      .filter((item) => String(item.client || "").trim().toLowerCase() === String(client.name || "").trim().toLowerCase())
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  function clientContinuityStatus(appointments, payments) {
    const completedCount = appointments.filter((item) => String(item.status || "").toLowerCase() === "completed").length;
    const hasUpcoming = appointments.some((item) => {
      const status = String(item.status || "").toLowerCase();
      return status !== "completed" && status !== "cancelled" && status !== "no_show";
    });
    if (completedCount >= 3 || (completedCount >= 2 && payments.length >= 2)) {
      return {
        label: t("clientsView.continuityStrong"),
        copy: currentLanguage() === "en" ? "The client already shows return and economic continuity." : "Il cliente mostra gia ritorno e continuita economica."
      };
    }
    if (completedCount >= 1 || hasUpcoming) {
      return {
        label: t("clientsView.continuityFragile"),
        copy: currentLanguage() === "en" ? "There is movement, but continuity must still be protected." : "C e movimento, ma la continuita va ancora protetta."
      };
    }
    if (appointments.length > 0 || payments.length > 0) {
      return {
        label: t("clientsView.continuityDormant"),
        copy: currentLanguage() === "en" ? "The client exists in the system but needs an operational reactivation." : "Il cliente esiste nel sistema ma richiede una riattivazione operativa."
      };
    }
    return {
      label: t("clientsView.continuityNew"),
      copy: currentLanguage() === "en" ? "New or still unexpressed client: first continuity must be built." : "Cliente nuovo o ancora non espresso: va costruita prima la continuita."
    };
  }

  function methodLabel(method) {
    const normalized = String(method || "card").toLowerCase();
    if (normalized === "cash") return t("cashdeskView.cash");
    if (normalized === "card") return t("cashdeskView.card");
    if (normalized === "mixed") return t("cashdeskView.mixed");
    return t("cashdeskView.bank");
  }

  function activeCashdeskPayments() {
    if (!state.cashdeskClientId) {
      return [...(state.sales || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    }
    const client = state.clients.find((item) => item.id === state.cashdeskClientId);
    if (!client) return [];
    return (state.sales || [])
      .filter((item) => String(item.client || "").trim().toLowerCase() === String(client.name || "").trim().toLowerCase())
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  function cashdeskOpenAppointments() {
    return state.appointments.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      const matchesClient = !state.cashdeskClientId || item.clientId === state.cashdeskClientId || findClientForAppointment(item)?.id === state.cashdeskClientId;
      return matchesClient && item.date === state.cashdeskDate && status !== "completed" && status !== "cancelled" && status !== "no_show";
    });
  }

  function cashdeskClosedSessionsToVerify() {
    return state.appointments.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      if (item.date !== state.cashdeskDate || status !== "completed") return false;
      const linkedClient = findClientForAppointment(item);
      const matchesClient = !state.cashdeskClientId || item.clientId === state.cashdeskClientId || linkedClient?.id === state.cashdeskClientId;
      if (!matchesClient) return false;
      const clientName = String(item.client || linkedClient?.name || "").trim().toLowerCase();
      if (!clientName) return false;
      const matchingPayments = (state.sales || []).filter((sale) => {
        return String(sale.date || "") === state.cashdeskDate && String(sale.client || "").trim().toLowerCase() === clientName;
      });
      return matchingPayments.length === 0;
    });
  }

  function cashdeskHistorySummary(payments) {
    const total = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const latestDate = payments.length ? String(payments[0].date || "") : "";
    return {
      total,
      count: payments.length,
      latestDate: latestDate || "--"
    };
  }

  function cashdeskDailyCheck(dayPayments, openSessions, linkedSessions) {
    const blockers = [];
    if (openSessions > 0) blockers.push(t("cashdeskView.blockerOpenSessions"));
    if (dayPayments.length === 0) blockers.push(t("cashdeskView.blockerNoPayments"));
    if (linkedSessions > dayPayments.length) blockers.push(t("cashdeskView.blockerClosedMoreThanPayments"));

    if (openSessions > 0 || (linkedSessions > 0 && dayPayments.length === 0)) {
      return {
        label: t("cashdeskView.dailyCritical"),
        risk: riskBandLabel("medium"),
        summary: t("cashdeskView.openAppointmentsWarning"),
        blockers
      };
    }

    if (linkedSessions > dayPayments.length) {
      return {
        label: t("cashdeskView.dailyAttention"),
        risk: riskBandLabel("medium"),
        summary: t("cashdeskView.blockerClosedMoreThanPayments"),
        blockers
      };
    }

    return {
      label: t("cashdeskView.dailyStrong"),
      risk: riskBandLabel("low"),
      summary: t("cashdeskView.cashReady"),
      blockers
    };
  }

  function clientGoldAction(selectedClient, continuity, upcomingAppointment, totalPayments) {
    const hasConsent = Boolean(selectedClient?.marketingConsent);
    const firstName = selectedClient?.firstName || selectedClient?.name?.split(" ")[0] || (currentLanguage() === "en" ? "Client" : "Cliente");

    if (continuity.label === t("clientsView.continuityDormant")) {
      return {
        title: t("clientsView.actionReactivation"),
        blocked: !hasConsent,
        reason: !hasConsent ? t("clientsView.actionConsentRequired") : "",
        message: currentLanguage() === "en"
          ? `Hi ${firstName}, it has been a while since your last visit. If you want, we can already prepare the next session in line with your journey.`
          : `Ciao ${firstName}, è passato un po' dall'ultima visita. Se vuoi, possiamo già preparare la prossima seduta in linea con il tuo percorso.`
      };
    }

    if (continuity.label === t("clientsView.continuityFragile")) {
      return {
        title: t("clientsView.actionContinuity"),
        blocked: false,
        reason: "",
        message: currentLanguage() === "en"
          ? `Hi ${firstName}, we are keeping your continuity under control. If you want, we can confirm the next useful session now.`
          : `Ciao ${firstName}, stiamo tenendo sotto controllo la tua continuita. Se vuoi, possiamo confermare ora la prossima seduta utile.`
      };
    }

    if (continuity.label === t("clientsView.continuityStrong") && (upcomingAppointment || totalPayments > 0)) {
      return {
        title: t("clientsView.actionUpsell"),
        blocked: !hasConsent,
        reason: !hasConsent ? t("clientsView.actionConsentRequired") : "",
        message: currentLanguage() === "en"
          ? `Hi ${firstName}, your path is moving well. If you want, we can suggest the next step most coherent with your current routine.`
          : `Ciao ${firstName}, il tuo percorso sta andando bene. Se vuoi, possiamo suggerirti il prossimo step piu coerente con la tua routine attuale.`
      };
    }

    return {
      title: t("clientsView.actionBuildRelationship"),
      blocked: false,
      reason: "",
      message: currentLanguage() === "en"
        ? `Hi ${firstName}, if you want we can prepare a first session built around your current needs and availability.`
        : `Ciao ${firstName}, se vuoi possiamo preparare una prima seduta costruita sulle tue esigenze e sulla tua disponibilita attuale.`
    };
  }

  return {
    filteredClients,
    clientAppointments,
    clientPayments,
    clientContinuityStatus,
    methodLabel,
    activeCashdeskPayments,
    cashdeskOpenAppointments,
    cashdeskClosedSessionsToVerify,
    cashdeskHistorySummary,
    cashdeskDailyCheck,
    clientGoldAction
  };
}
