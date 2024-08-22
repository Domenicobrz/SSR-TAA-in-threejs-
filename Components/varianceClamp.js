import * as THREE from "three";
import { Vector2, Vector3 } from "three";
import Utils from "./utils";
import { defaultWhiteTexture, defaultBlackTexture } from "./defaultTextures";

export default class VarianceClamp {
  constructor(
    drt,
    normalTexture,
    positionTexture,
    materialTexture,
    oldMaterialTexture,
    renderer
  ) {
    this.drt = drt;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uOldMaterial: { type: "t", value: oldMaterialTexture },
        uMaterial: { type: "t", value: materialTexture },
        uPosition: { type: "t", value: positionTexture },
        uNormal: { type: "t", value: normalTexture },
        uOldSSRColor: { type: "t", value: null },
        uSSRColor: { type: "t", value: null },
        uOldSSRIntersection: { type: "t", value: null },
        uSSRIntersection: { type: "t", value: null },
        uTAA: { type: "t", value: null },

        uOldViewMatrix: { value: new THREE.Matrix4() },
        uOldCameraPos: { value: new THREE.Vector3(0, 0, 0) },
        uAccumTimeFactor: { value: 0.9 },
        uInvScreen: { value: new Vector2(1 / innerWidth, 1 / innerHeight) },
      },

      vertexShader: `
        varying vec2 vUv;
        varying mat4 vProjectionMatrix;

        void main() {
          vUv = uv;
          vProjectionMatrix = projectionMatrix;

          gl_Position = vec4(position.xy, 0.0, 1.0);    
        }
      `,

      fragmentShader: `
        varying vec2 vUv;
        varying mat4 vProjectionMatrix;

        uniform sampler2D uOldMaterial;
        uniform sampler2D uMaterial;
        uniform sampler2D uPosition;
        uniform sampler2D uNormal;
        uniform sampler2D uOldSSRColor;
        uniform sampler2D uOldSSRIntersection;
        uniform sampler2D uSSRColor;
        uniform sampler2D uSSRIntersection;
        uniform sampler2D uTAA;

        uniform vec3 uOldCameraPos;
        uniform mat4 uOldViewMatrix;
        uniform float uAccumTimeFactor;
        uniform vec2 uInvScreen;

        vec3 findReflectionPoint(
          vec3 point, vec3 cameraPos, vec3 planeOrigin, vec3 planeNormal
        ) {
          float p1d = dot(point - planeOrigin, planeNormal);
          float p2d = dot(cameraPos - planeOrigin, planeNormal);

          vec3 p1_planeProj = point - p1d * planeNormal;
          vec3 p2_planeProj = cameraPos - p2d * planeNormal;

          float t = p1d / (p1d + p2d);

          return (p2_planeProj - p1_planeProj) * t + p1_planeProj;
        } 

        void main() {
          vec4 posTexel = texture2D(uPosition, vUv);
          vec3 pos      = posTexel.xyz;
          float depth   = posTexel.w;
          vec3 norm     = normalize(texture2D(uNormal, vUv).xyz);
          vec4 material = texture2D(uMaterial, vUv);
          float meshId  = material.w;

          vec4 ssrInt = texture2D(uSSRIntersection, vUv);
          float reflectionMeshId = ssrInt.w;

          vec3 oldReflPoint = findReflectionPoint(ssrInt.xyz, uOldCameraPos, pos, norm);
          vec4 projP3 = vProjectionMatrix * uOldViewMatrix * vec4(oldReflPoint, 1.0);
          vec2 p3Uv = (projP3 / projP3.w).xy * 0.5 + 0.5;
          vec3 reprojectedColor = texture2D(uOldSSRColor, p3Uv).xyz;

          float oldReflectionMeshId = texture2D(uOldSSRIntersection, p3Uv).w;
          float reprojectedSurfaceMeshId = texture2D(uOldMaterial, p3Uv).w;

          vec4 taaBuffer = texture2D(uTAA, vUv);
          const float MAX_ACCUM_COUNT = 10.0;
          float accum = min(taaBuffer.z, MAX_ACCUM_COUNT);
          float a = (accum * (1.0 / MAX_ACCUM_COUNT)) * uAccumTimeFactor;

          if (abs(meshId - reprojectedSurfaceMeshId) > 0.5) {
            a = 0.0;
          }
          if (abs(reflectionMeshId - oldReflectionMeshId) > 0.5) {
            a = 0.0;
          }

          // neighbor search + AABB clamping
          vec3 minColor = vec3(999.0);
          vec3 maxColor = vec3(-999.0);
          vec3 currColor = vec3(0.0);
          for (int i = -1; i <= 1; i++) {
            for (int j = -1; j <= 1; j++) {
              vec2 offs = vec2(i, j) * uInvScreen;
              vec3 col = texture2D(uSSRColor, vUv + offs).xyz;
              minColor = min(minColor, col);
              maxColor = max(maxColor, col);

              if (i == 0 && j == 0) currColor = col;
            }
          }


          // what to do next:
          // I'm missing all the meshId checks I was doing in ssr.js
          // something cool I've already noticed: by increasing the number of samples,
          // the ghosting is already diminished if we compare both methods! 
          // (with and without clamping)
          // --- NOTE: you're also using p3 and lastP3 since unfortunately the 
          // paper motion vectors are still not working


          // Clamp previous color to min/max bounding box
          vec3 previousColorClamped = clamp(reprojectedColor, minColor, maxColor);
          vec3 fCol = currColor * (1.0 - a) + previousColorClamped * a;
          gl_FragColor = vec4(fCol, 1.0);


          // if (vUv.x < 0.5) {
          //   vec3 previousColorClamped = clamp(reprojectedColor, minColor, maxColor);
          //   vec3 fCol = currColor * (1.0 - a) + previousColorClamped * a;
          //   gl_FragColor = vec4(fCol, 1.0);
          // } else {
          //   vec3 previousColorClamped = reprojectedColor;
          //   vec3 fCol = currColor * (1.0 - a) + previousColorClamped * a;
          //   gl_FragColor = vec4(fCol, 1.0);
          // }
        }
      `,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(2, 2),
      this.material
    );
    this.mesh.frustumCulled = false;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  compute(SSRProgram, TAAProgram, sceneCamera, guiControls) {
    this.drt.swap();

    // initialize old camera matrices if they don't exist yet
    if (!this.lastViewMatrixInverse) {
      this.lastViewMatrixInverse = sceneCamera.matrixWorldInverse.clone();
      this.lastCameraPos = sceneCamera.position.clone();
    }

    this.material.uniforms.uOldViewMatrix.value = this.lastViewMatrixInverse;
    this.material.uniforms.uOldCameraPos.value.set(
      this.lastCameraPos.x,
      this.lastCameraPos.y,
      this.lastCameraPos.z
    );

    this.material.uniforms.uOldSSRColor.value = this.drt.read;
    this.material.uniforms.uOldSSRIntersection.value =
      SSRProgram.SSRRT.read.texture[1];

    this.material.uniforms.uSSRColor.value = SSRProgram.SSRRT.write.texture[0];
    this.material.uniforms.uSSRIntersection.value =
      SSRProgram.SSRRT.write.texture[1];

    this.material.uniforms.uTAA.value = TAAProgram.momentMoveRT.write.texture;
    this.material.uniforms.uAccumTimeFactor.value = guiControls.accumTimeFactor;

    this.renderer.setRenderTarget(this.drt.write);
    this.renderer.render(this.scene, sceneCamera);
    this.renderer.setRenderTarget(null);

    this.lastViewMatrixInverse = sceneCamera.matrixWorldInverse.clone();
    this.lastCameraPos = sceneCamera.position.clone();
  }
}
