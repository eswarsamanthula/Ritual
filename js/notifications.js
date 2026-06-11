// ============================================================
//  RITUAL — NOTIFICATIONS
//  Daily habit reminder push notifications.
// ============================================================

let notifPermission = Notification?.permission || 'default';

// ─── INIT ────────────────────────────────────────────────────
function initNotifications() {
  if (!('Notification' in window)) return;
  notifPermission = Notification.permission;

  const dismissed = localStorage.getItem('ritual_notif_dismissed');
  if (notifPermission === 'default' && !dismissed) {
    const banner = document.getElementById('notif-banner');
    if (banner) banner.classList.remove('hidden');
  }
}

// ─── REQUEST PERMISSION ──────────────────────────────────────
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser');
    return false;
  }
  const result = await Notification.requestPermission();
  notifPermission = result;
  if (result === 'granted') {
    showToast('Notifications enabled ✓');
    new Notification('Ritual ◎', {
      body: "You'll get daily reminders to log your habits.",
      icon: 'icons/icon-192.png',
      tag: 'ritual-welcome',
    });
    return true;
  } else {
    showToast('Notifications blocked — enable in browser settings.');
    return false;
  }
}

let _reminderTimeout = null;
let _reminderInterval = null;

function clearReminders() {
  if (_reminderTimeout) { clearTimeout(_reminderTimeout); _reminderTimeout = null; }
  if (_reminderInterval) { clearInterval(_reminderInterval); _reminderInterval = null; }
}

// ─── SCHEDULE DAILY REMINDER ─────────────────────────────────
// Call this after login to set a daily 8pm reminder if not already set
function scheduleDailyReminder() {
  if (notifPermission !== 'granted') return;
  clearReminders();

  const now = new Date();
  const next = new Date();
  next.setHours(20, 0, 0, 0); // 8pm today
  if (next <= now) next.setDate(next.getDate() + 1); // if past 8pm, schedule for tomorrow

  const delay = next - now;
  _reminderTimeout = setTimeout(() => {
    fireHabitReminder();
    _reminderInterval = setInterval(fireHabitReminder, 24 * 60 * 60 * 1000);
  }, delay);
}

// ─── FIRE REMINDER ───────────────────────────────────────────
function fireHabitReminder() {
  if (notifPermission !== 'granted') return;
  const n = new Notification('Ritual ◎ — Daily check-in', {
    body: "Don't forget to log your habits today.",
    icon: 'icons/icon-192.png',
    tag: 'ritual-daily',
    renotify: true,
    vibrate: [200, 100, 200],
  });
  n.onclick = () => { window.focus(); n.close(); };
}
