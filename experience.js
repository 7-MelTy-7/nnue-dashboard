class ExperienceEngine {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'experience-canvas';
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.particles = [];
        this.state = 'calm';
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.init();
        this.observeData();
        window.addEventListener('resize', () => this.resize());
    }

    init() {
        this.resize();
        this.createParticles();
        this.animate();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    createParticles() {
        this.particles = [];
        const count = window.innerWidth < 768 ? 40 : 100;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                r: Math.random() * 3 + 1,
                speed: Math.random() * 0.5 + 0.2,
                color: '#ffffff'
            });
        }
    }

    observeData() {
        const target = document.body;
        const observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                if (m.attributeName === 'data-level') {
                    const level = parseInt(target.getAttribute('data-level'));
                    this.updateState(level > 80 ? 'intense' : 'calm');
                }
            });
        });
        observer.observe(target, { attributes: true });
        target.setAttribute('data-state', 'calm');
    }

    updateState(newState) {
        if (this.state === newState) return;
        this.state = newState;
        document.body.setAttribute('data-state', newState);

        this.particles.forEach(p => {
            p.speed = newState === 'intense'
                ? Math.random() * 3 + 2
                : Math.random() * 0.5 + 0.2;
            p.color = newState === 'intense' ? '#ffd700' : '#ffffff';
        });
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle =
          this.state === 'intense'
            ? 'rgba(255,215,0,0.8)'
            : 'rgba(255,255,255,0.8)';

        this.particles.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            this.ctx.fill();
            p.y += p.speed;
            p.x += Math.sin(p.y / 50) * 0.5;
            if (p.y > this.height) {
                p.y = -10;
                p.x = Math.random() * this.width;
            }
        });
    }

    animate() {
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.experience = new ExperienceEngine();

    document.querySelectorAll('.panel').forEach(panel => {
        const frost = document.createElement('div');
        frost.className = 'frost-edge';
        panel.appendChild(frost);
    });
});
