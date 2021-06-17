import * as THREE from "three";
import DoubleRT from "./doubleRT";

export default class TAA {
    constructor(renderer, scene, camera, normalRT, positionRT) {
        this.momentMoveRT = DoubleRT(positionRT.width, positionRT.height, THREE.NearestFilter);
        
        this.momentBufferMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uOldModelViewMatrix: { value: new THREE.Matrix4() },
                uPosition:           { type: "t", value: positionRT.texture },
                uNormal:             { type: "t", value: normalRT.texture },
                uLastMomentMove:     { type: "t", value: null },
            },

            vertexShader: `
            varying vec3 vFragPos;
            varying mat4 modelViewMat;
            varying mat4 vProjectionMatrix;
            varying vec3 vNormal;
            varying vec3 vWorldFragPos;

            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                
                vFragPos = position;
                modelViewMat = modelViewMatrix;
                vProjectionMatrix = projectionMatrix;
                vNormal = transpose(inverse(mat3(modelMatrix))) * normal;
                vWorldFragPos = (modelMatrix * vec4(position, 1.0)).xyz;
            }`,

            fragmentShader: `
            varying vec3 vFragPos;
            varying mat4 modelViewMat;
            varying mat4 vProjectionMatrix;
            varying vec3 vNormal;
            varying vec3 vWorldFragPos;

            uniform mat4 uOldModelViewMatrix;
            uniform sampler2D uNormal;
            uniform sampler2D uPosition;
            uniform sampler2D uLastMomentMove;

            void main() {
                vec4 ndcOldPos = vProjectionMatrix * uOldModelViewMatrix * vec4(vFragPos, 1.0);
                vec4 ndcNewPos = vProjectionMatrix * modelViewMat * vec4(vFragPos, 1.0);
                ndcOldPos.xyzw /= ndcOldPos.w;
                ndcNewPos.xyzw /= ndcNewPos.w;
                ndcOldPos.xy = ndcOldPos.xy * 0.5 + 0.5;
                ndcNewPos.xy = ndcNewPos.xy * 0.5 + 0.5;


                // reprojection/accumulation test
                vec2 olduv = ndcOldPos.xy;
                vec3 oldNormal = texture2D(uNormal, olduv).xyz;
                vec3 oldWorldPosition = texture2D(uPosition, olduv).xyz;
                vec3 normal = normalize(vNormal);
                float oldAccum  = texture2D(uLastMomentMove, olduv).z;
                float newAccum  = oldAccum + 1.0;


                // I think this reprojection shader has a problem, the "old normal" could
                // be different because e.g. the model was rotated, so the pixel might be valid,
                // but a previous rotation could have changed the normal enough so that the test fails


                if(dot(oldNormal, normal) < 0.94) newAccum = 0.0;
                // if(length(oldWorldPosition - vWorldFragPos) > 0.175) newAccum = 0.0;

                gl_FragColor = vec4(ndcOldPos.xy - ndcNewPos.xy, newAccum, 1.0);
                // test that looks beautiful: (try it)
                // gl_FragColor = vec4(newAccum / 20.0, 0.0, newAccum, 1.0);
            }`,

            side: THREE.DoubleSide,
        });

        this.renderer = renderer;

        this.momentBufferScene = new THREE.Scene();

        this.scene = scene;
        this.camera = camera;
        this.lastViewMatrixInverse = camera.matrixWorldInverse.clone();
        
        this.updateOldMatrices();
    }

    computeMoment() {
        // this.camera.matrixWorldInverse.clone();
        // if(!this.camera.matrixWorldInverse.equals(this.lastViewMatrixInverse)) {
        //     console.log("matrices are different");
        // }

        this.momentMoveRT.swap();

        let autoClearOpt = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.momentMoveRT.write);
        this.renderer.clear();

        this.momentBufferMaterial.uniforms.uLastMomentMove.value = this.momentMoveRT.read.texture;

        for(let i = this.scene.children.length - 1; i >= 0; i--) {
            this.scene.children[i].savedMaterial = this.scene.children[i].material;
            this.scene.children[i].material = this.momentBufferMaterial;
    
            // if(this.scene.children[i].savedMaterial.side == THREE.BackSide) {
            //     this.momentBufferMaterial.side = THREE.BackSide;
            // } else {
            //     this.momentBufferMaterial.side = THREE.DoubleSide;   
            // }
            this.momentBufferMaterial.needsUpdate = true;
    
            let viewModelMatrix = new THREE.Matrix4();
            viewModelMatrix.multiplyMatrices(this.lastViewMatrixInverse, this.scene.children[i].oldWorldMatrix);
            this.momentBufferMaterial.uniforms.uOldModelViewMatrix.value = viewModelMatrix;
            this.momentBufferMaterial.uniforms.uOldModelViewMatrix.needsUpdate = true;
            this.momentBufferMaterial.uniforms.needsUpdate = true;
    
            // remember: momentBufferScene will always hold 1 single object each time render() is called
            this.momentBufferScene.add(this.scene.children[i]);
    
            this.renderer.render( this.momentBufferScene, this.camera );
    
            // reassign original material
            this.momentBufferScene.children[0].material = this.momentBufferScene.children[0].savedMaterial;

            // re-add again this object to scene since it was removed by momentBufferScene.add(...)
            // it should also remove the object from momentBufferScene
            this.scene.add(this.momentBufferScene.children[0]);
        }
        this.renderer.autoClear = autoClearOpt;
        this.renderer.setRenderTarget(null);

        this.updateOldMatrices();
    }

    updateOldMatrices() {
        // updated "old" matrices
        this.lastViewMatrixInverse = this.camera.matrixWorldInverse.clone();
        for(let i = 0; i < this.scene.children.length; i++) {
            this.scene.children[i].oldWorldMatrix = this.scene.children[i].matrixWorld.clone();
        }
    }
}