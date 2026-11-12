// MKCA Insurance Platform - Main Script

document.addEventListener('DOMContentLoaded', () => {
  setupMobileMenu();
  setupBackToTop();
  setupFAQAccordion();
  setupCharts();
  setupFormValidation();
});

/**
 * Mobile Menu Setup
 */
function setupMobileMenu() {
  const mobileMenuButton = document.getElementById('mobileMenuButton');
  const mobileCloseButton = document.getElementById('mobileCloseButton');
  const mobileNav = document.getElementById('mobileNav');

  if (!mobileMenuButton || !mobileNav) return;

  mobileMenuButton.addEventListener('click', () => {
    mobileNav.classList.add('active');
    mobileNav.classList.remove('hidden');
  });

  if (mobileCloseButton) {
    mobileCloseButton.addEventListener('click', () => {
      mobileNav.classList.remove('active');
      mobileNav.classList.add('hidden');
    });
  }

  // Close menu when link is clicked
  const mobileLinks = mobileNav.querySelectorAll('a');
  mobileLinks.forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('active');
      mobileNav.classList.add('hidden');
    });
  });

  // Close menu when clicking outside
  mobileNav.addEventListener('click', event => {
    if (event.target === mobileNav) {
      mobileNav.classList.remove('active');
      mobileNav.classList.add('hidden');
    }
  });
}

/**
 * Back to Top Button
 */
function setupBackToTop() {
  const backToTop = document.getElementById('backToTop');
  if (!backToTop) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      backToTop.classList.remove('hidden');
    } else {
      backToTop.classList.add('hidden');
    }
  });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/**
 * FAQ Accordion
 */
function setupFAQAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const button = item.querySelector('button');
    if (!button) return;

    button.addEventListener('click', () => {
      // Close other items
      faqItems.forEach(other => {
        if (other !== item && other.classList.contains('active')) {
          other.classList.remove('active');
        }
      });

      // Toggle current item
      item.classList.toggle('active');
    });
  });
}

/**
 * Initialize Charts
 */
function setupCharts() {
  initializePoliciesChart();
  initializeClaimsChart();
}

function initializePoliciesChart() {
  const ctx = document.getElementById('policiesChart');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        {
          label: 'Policies Issued',
          data: [120, 190, 240, 380, 520, 680],
          borderColor: '#0F4C81',
          backgroundColor: 'rgba(15, 76, 129, 0.05)',
          tension: 0.4,
          fill: true,
          borderWidth: 2
        },
        {
          label: 'Premium Revenue (ZMW 000)',
          data: [80, 140, 180, 290, 420, 580],
          borderColor: '#6B7280',
          backgroundColor: 'rgba(107, 114, 128, 0.05)',
          tension: 0.4,
          fill: true,
          borderWidth: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Policies'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Revenue (ZMW 000)'
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

function initializeClaimsChart() {
  const ctx = document.getElementById('claimsChart');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Approved', 'Pending', 'Under Review', 'Rejected'],
      datasets: [
        {
          data: [156, 42, 28, 8],
          backgroundColor: [
            '#10b981',
            '#f59e0b',
            '#0F4C81',
            '#ef4444'
          ],
          borderColor: '#ffffff',
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'bottom'
        }
      }
    }
  });
}

/**
 * Form Validation
 */
function setupFormValidation() {
  const forms = document.querySelectorAll('form');
  
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!form.checkValidity()) {
        e.preventDefault();
        e.stopPropagation();
      }
      form.classList.add('was-validated');
    });
  });
}

/**
 * Utility: Get URL Parameter
 */
function getUrlParameter(param) {
  const params = new URLSearchParams(window.location.search);
  return params.get(param);
}

/**
 * Utility: Format Currency
 */
function formatCurrency(value) {
  return 'ZMW ' + Math.round(value).toLocaleString();
}

/**
 * Utility: Parse Query Parameters
 */
function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(params);
}
