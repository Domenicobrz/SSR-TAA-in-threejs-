import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import Blit from "./Components/blit";
import BlitDepth from "./Components/blitDepth";
import BlitNormals from "./Components/blitNormals";
import BlitPosition from "./Components/blitPosition";
import SSR, { SSRMaterial } from "./Components/ssr";
import TAA from "./Components/taa";
import Atrous from "./Components/atrous";
import SSRBuffers from "./Components/ssrBuffers";
import { defaultWhiteTexture } from "./Components/defaultTextures";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';

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
let testTexture = new THREE.TextureLoader().load("https://png.pngtree.com/png-clipart/20190516/original/pngtree-vector-seamless-pattern-modern-stylish-texture-repeating-geometric-background-png-image_3595804.jpg");
// let texture;


let pmremGenerator = new THREE.PMREMGenerator( renderer );
let envmapEqui;
new RGBELoader()
.setDataType( THREE.UnsignedByteType ) // alt: FloatType, HalfFloatType
.load("assets/envmap.hdr", function ( texture, textureData ) {
    envmapEqui = texture;
    let envmap = pmremGenerator.fromEquirectangular( texture ).texture;
    scene.environment = envmap;
    scene.background = envmap;

    // let ground = new THREE.Mesh(new THREE.BoxBufferGeometry(500, 2, 500), new THREE.MeshPhongMaterial({ color: 0xffffff, map: testTexture }));
    let ground = new THREE.Mesh(
        new THREE.BoxBufferGeometry(500, 2, 500), 
        SSRMaterial({ color: 0xffffff, envMap: envmap })
    );
    // let ground = new THREE.Mesh(new THREE.BoxBufferGeometry(500, 2, 500), new THREE.MeshPhongMaterial({ color: 0x222222, map: testTexture }));
    ground.position.set(0, -5, 0);
    ground.castShadow = true; 
    ground.receiveShadow = true; 
    ground.material.roughness = 0.15;
    ground.material.metalness = 1;
    scene.add(ground);

    let boxGeometry = new THREE.TorusKnotGeometry( 3, 0.7, 100, 16, 4 );
    // let boxGeometry = new THREE.BoxBufferGeometry(3,7,3);
    let box = new THREE.Mesh(boxGeometry, SSRMaterial({ color: 0xf5f341, map: testTexture, envMap: envmap }));
    box.castShadow = true; 
    box.receiveShadow = true; 
    box.material.roughness = 0.15;
    box.material.metalness = 0;
    scene.add(box);

    for(let i = 0; i < 9; i++) {
        let y = 2 + Math.random() * 9;
        let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), SSRMaterial({ color: 0xf5f341, map: testTexture, envMap: envmap }));
        let angle = -i / 7 * Math.PI;
        let x = Math.cos(angle) * 15;
        let z = Math.sin(angle) * 15;

        box.castShadow = true; 
        box.receiveShadow = true; 
        box.position.set(x, +y * 0.5 - 4, z);
        box.material.roughness = 0.15;
        box.material.metalness = 0;

        scene.add(box);
    }
});

// for(let i = 0; i < 15; i++) {
//     let y = 2 + Math.random() * 9;
//     let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: testTexture }));
//     box.castShadow = true; 
//     box.receiveShadow = true; 
//     box.position.set(-8, +y * 0.5 - 4, -i * 5 + 30);

//     scene.add(box);
// }
// for(let i = 0; i < 15; i++) {
//     let y = 2 + Math.random() * 9;
//     let box = new THREE.Mesh(new THREE.BoxBufferGeometry(3, y, 3), new THREE.MeshPhongMaterial({ color: 0xf5f341, map: testTexture }));
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
light2.position.set(16, 17, 5);

// scene.add(light1, light2);

let colorRT             = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

let SSRBuffersProgram   = new SSRBuffers(innerWidth, innerHeight);
let TAAProgram          = new TAA(renderer, scene, camera, SSRBuffersProgram.GTextures.normal, SSRBuffersProgram.GTextures.position);
let SSRProgram          = new SSR(renderer, camera, controls, 
    SSRBuffersProgram.GTextures.normal, 
    SSRBuffersProgram.GTextures.position, 
    SSRBuffersProgram.GTextures.albedo, 
    SSRBuffersProgram.GTextures.material, 
    colorRT);
let AtrousProgram       = new Atrous(renderer, SSRBuffersProgram.GTextures.normal, SSRBuffersProgram.GTextures.position, SSRProgram.SSRRT);
let blitProgram         = new Blit(renderer);

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

    let delta = clock.getDelta();
    if(kdown) fov -= 0.15;
    if(ldown) fov += 0.15;

    camera.fov = fov;
    camera.updateProjectionMatrix();

    // update controls after moving / changing the camera
    controls.update();



    // TAA computation happens before updating normals and position RT
    TAAProgram.computeMoment();
    // blitProgram.blit(TAAProgram.momentMoveRT.write.texture, null);

    SSRBuffersProgram.compute(renderer, scene, camera);
    // blitProgram.blit(SSRBuffersProgram.GBuffer.texture[3], null);

    renderer.setRenderTarget(colorRT);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    renderer.shadowMap.needsUpdate = false;

    SSRProgram.compute(TAAProgram.momentMoveRT.write, envmapEqui);
    AtrousProgram.compute(SSRProgram.SSRRT.write.texture[0], TAAProgram.momentMoveRT.write.texture);
    SSRProgram.apply(AtrousProgram.atrousRT.write.texture, null);



    requestAnimationFrame(animate);
}

animate();