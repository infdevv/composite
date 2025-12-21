let inner = `
        <style>
.galaxy {
    width: 100vw;
    height: 100vh;
    position: fixed;
    top: 0;
    left: 0;
    overflow: hidden;
    z-index: -1;
    background: transparent;
}

.stars-layer {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    background: transparent;
}

@keyframes animate_stars {
    0% {
        transform: translateY(0);
    }
    100% {
        transform: translateY(-100vh);
    }
}
        </style>
`;

let div = document.createElement("div");
div.classList.add("galaxy");
div.innerHTML = inner;
document.body.insertBefore(div, document.body.firstChild);

const galaxy = document.querySelector('.galaxy');

const starConfigs = [
    { count: 300, size: 1, speed: 30, className: 'stars1' },
    { count: 150, size: 2, speed: 50, className: 'stars2' },
    { count: 75, size: 3, speed: 100, className: 'stars3' }
];

function generateStars(layerConfig) {
    const layer = document.createElement('div');
    layer.classList.add('stars-layer', layerConfig.className);
    
    let boxShadow = '';
    const maxWidth = window.innerWidth;
    const maxHeight = window.innerHeight;
    
    for (let i = 0; i < layerConfig.count; i++) {
        const x = Math.floor(Math.random() * maxWidth);
        const y = Math.floor(Math.random() * maxHeight);
        boxShadow += `${x}px ${y}px #fff`;
        
        if (i < layerConfig.count - 1) {
            boxShadow += ', ';
        }
    }
    
    layer.style.cssText = `
        width: ${layerConfig.size}px;
        height: ${layerConfig.size}px;
        background-color: transparent;
        position: relative;
        box-shadow: ${boxShadow};
        animation: animate_stars ${layerConfig.speed}s linear infinite;
    `;
    
    const afterStyle = document.createElement('style');
    afterStyle.textContent = `
        .${layerConfig.className}:after {
            content: "";
            width: ${layerConfig.size}px;
            height: ${layerConfig.size}px;
            position: absolute;
            top: ${maxHeight}px;
            left: 0;
            background-color: transparent;
            box-shadow: ${boxShadow};
        }
    `;
    
    galaxy.appendChild(layer);
    galaxy.appendChild(afterStyle);
}

function initStars() {
    const existingLayers = galaxy.querySelectorAll('.stars-layer');
    const existingStyles = galaxy.querySelectorAll('style:not(:first-of-type)');
    
    existingLayers.forEach(layer => layer.remove());
    existingStyles.forEach(style => style.remove());
    
    starConfigs.forEach(config => {
        generateStars(config);
    });
}
window.addEventListener('load', initStars);

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(initStars, 250);
});

let touchTimeout;
window.addEventListener('orientationchange', () => {
    clearTimeout(touchTimeout);
    touchTimeout = setTimeout(initStars, 500);
});