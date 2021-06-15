import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import Blit from "./Components/blit";
import BlitDepth from "./Components/blitDepth";
import BlitNormals from "./Components/blitNormals";
import BlitPosition from "./Components/blitPosition";
import SSR from "./Components/ssr";
import TAA from "./Components/taa";

let scene = new THREE.Scene();

let camera = new THREE.PerspectiveCamera( 40, innerWidth / innerHeight, 0.1, 1000 );
// camera.position.set(0, 2, 57);
camera.position.set(-28, 25, 42);

let renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping    = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputEncoding = THREE.sRGBEncoding; 
renderer.shadowMap.autoUpdate = false;
document.body.appendChild(renderer.domElement);

let controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0,0);

let clock = new THREE.Clock();
clock.start();

// let texture = new THREE.TextureLoader().load("https://thumbs.dreamstime.com/b/white-grey-hexagon-background-texture-d-render-metal-illustration-82112026.jpg");
let texture = new THREE.TextureLoader().load("https://png.pngtree.com/png-clipart/20190516/original/pngtree-vector-seamless-pattern-modern-stylish-texture-repeating-geometric-background-png-image_3595804.jpg");
// let texture;

let ground = new THREE.Mesh(new THREE.BoxBufferGeometry(500, 2, 500), new THREE.MeshPhongMaterial({ color: 0xffffff, map: texture }));
// let ground = new THREE.Mesh(new THREE.BoxBufferGeometry(500, 2, 500), new THREE.MeshPhongMaterial({ color: 0x222222, map: texture }));
ground.position.set(0, -5, 0);
ground.castShadow = true; 
ground.receiveShadow = true; 

let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3,7,3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: texture }));
box.castShadow = true; 
box.receiveShadow = true; 
scene.add(box);

for(let i = 0; i < 9; i++) {
    let y = 2 + Math.random() * 9;
    let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: texture }));
    let angle = -i / 7 * Math.PI;
    let x = Math.cos(angle) * 15;
    let z = Math.sin(angle) * 15;

    box.castShadow = true; 
    box.receiveShadow = true; 
    box.position.set(x, +y * 0.5 - 4, z);

    scene.add(box);
}

// for(let i = 0; i < 15; i++) {
//     let y = 2 + Math.random() * 9;
//     let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: texture }));
//     box.castShadow = true; 
//     box.receiveShadow = true; 
//     box.position.set(-8, +y * 0.5 - 4, -i * 5 + 30);

//     scene.add(box);
// }
// for(let i = 0; i < 15; i++) {
//     let y = 2 + Math.random() * 9;
//     let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: texture }));
//     box.castShadow = true; 
//     box.receiveShadow = true; 
//     box.position.set(8, +y * 0.5 - 4, -i * 5 + 30);

//     scene.add(box);
// }


let light1 = new THREE.PointLight(0x88aaff, 0.5, 300, 1);
light1.castShadow = true;
light1.position.set(-16, 17, 5);

let light2 = new THREE.PointLight(0xffbb88, 0.5, 100, 1);
light2.castShadow = true;
light2.position.set(16, 17, 35);

scene.add(ground, light1, light2);

let normalsRT  = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType });
let positionRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType });
let depthRT    = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType, format: THREE.RedFormat });
let colorRT    = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

let TAAProgram          = new TAA(renderer, scene, camera, normalsRT, positionRT);
let SSRProgram          = new SSR(renderer, camera, controls, normalsRT, positionRT, depthRT, colorRT);
let blitProgram         = new Blit(renderer);
let blitNormalsProgram  = new BlitNormals(renderer, scene, camera);
let blitPositionProgram = new BlitPosition(renderer, scene, camera);
let blitDepthProgram    = new BlitDepth(renderer, scene, camera);

let fov = 40;
let kdown = false;
let ldown = false;
window.addEventListener("keydown", (e) => {
    if(e.key == "k") kdown = true;
    if(e.key == "l") ldown = true;
});
window.addEventListener("keyup", (e) => {
    if(e.key == "k") kdown = false;
    if(e.key == "l") ldown = false;
});

function animate() {
    controls.update();

    let delta = clock.getDelta();
    if(kdown) fov -= 0.15;
    if(ldown) fov += 0.15;

    camera.fov = fov;
    camera.updateProjectionMatrix();


    // TAA computation happens before updating normals and position RT
    TAAProgram.computeMoment();
    // blitProgram.blit(TAAProgram.momentMoveRT.write.texture, null);

    blitNormalsProgram.blitNormals(normalsRT);
    // blitProgram.blit(normalsRT.texture, null);

    blitPositionProgram.blitPosition(positionRT);
    // // blitProgram.blit(positionRT.texture, null);

    blitDepthProgram.blitDepth(depthRT);
    // blitProgram.blit(depthRT.texture, null);

    renderer.setRenderTarget(colorRT);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    renderer.shadowMap.needsUpdate = false;

    SSRProgram.compute(TAAProgram.momentMoveRT.write);
    // blitProgram.blit(SSRProgram.SSRRT.write.texture[0], null);
    SSRProgram.apply(null);


    // // SSRProgram.compute(ssrRT);
    // // blitProgram.blit(ssrRT.texture, null);
    
    // // renderer.setRenderTarget(null);
    // // renderer.shadowMap.needsUpdate = true;
    // // renderer.render(scene, camera);

    requestAnimationFrame(animate);
}

animate();