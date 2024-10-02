// Switch entre les thèmes clair et sombre
document.getElementById('theme-switch').addEventListener('change', function() {
    if (this.checked) {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
});
