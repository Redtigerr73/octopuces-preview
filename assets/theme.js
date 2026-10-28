/* Applique le thème choisi avant le premier rendu (évite un flash). */
try { const p = JSON.parse(localStorage.getItem('etiket-prefs-v1') || '{}'); if (p.theme) document.documentElement.dataset.theme = p.theme; } catch { /* stockage bloqué : thème par défaut */ }
