import * as THREE from "three";
import DoubleRT from "./doubleRT";

export default class TAA {
    constructor(renderer, scene, camera, normalTexture, positionTexture, materialTexture) {
        this.momentMoveRT = DoubleRT(positionTexture.image.width, positionTexture.image.height, THREE.NearestFilter);
        
        this.momentBufferMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMeshId:             { value: 0 },
                uOldCameraPos:       { value: new THREE.Vector3(0,0,0) },
                uOldModelViewMatrix: { value: new THREE.Matrix4() },
                uOldViewMatrix:      { value: new THREE.Matrix4() },
                uPosition:           { type: "t", value: positionTexture },
                uNormal:             { type: "t", value: normalTexture },
                uMaterial:           { type: "t", value: materialTexture },
                uLastMomentMove:     { type: "t", value: null },
                uSSRPosition:        { type: "t", value: null },
            },

            vertexShader: `
            varying vec3 vFragPos;
            varying mat4 vViewMat;
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
                vViewMat = viewMatrix;
            }`,

            fragmentShader: `
            varying vec3 vFragPos;
            varying mat4 modelViewMat;
            varying mat4 vProjectionMatrix;
            varying vec3 vNormal;
            varying vec3 vWorldFragPos;
            varying mat4 vViewMat;

            uniform vec3 uOldCameraPos;
            uniform mat4 uOldModelViewMatrix;
            uniform mat4 uOldViewMatrix;

            uniform float uMeshId;
            uniform sampler2D uNormal;
            uniform sampler2D uPosition;
            uniform sampler2D uMaterial;
            uniform sampler2D uLastMomentMove;
            uniform sampler2D uSSRPosition;

            vec3 proj_point_in_plane(vec3 p, vec3 v0, vec3 n, out float d) {
                d = dot(n, p - v0);
                return p - (n * d);
            }
               
            vec3 find_reflection_incident_point(vec3 p0, vec3 p1, vec3 v0, vec3 n) {
                float d0 = 0.0;
                float d1 = 0.0;
                vec3 proj_p0 = proj_point_in_plane(p0, v0, n, d0);
                vec3 proj_p1 = proj_point_in_plane(p1, v0, n, d1);
    
                if(d0 < d1)
                    return (proj_p0 - proj_p1) * d1/(d0+d1) + proj_p1;
                else
                    return (proj_p1 - proj_p0) * d0/(d0+d1) + proj_p0;
            }

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
                vec3 oldIntersectionPoint = texture2D(uSSRPosition, olduv).xyz;
                vec3 normal = normalize(vNormal);
                float oldAccum  = texture2D(uLastMomentMove, olduv).z;
                float newAccum  = oldAccum + 1.0;

                float oldMeshId  = texture2D(uMaterial, olduv).w;


                vec2 moveDelta  = ndcOldPos.xy - ndcNewPos.xy;
                // if we moved the camera too much, lower t (taaBuffer has momentMove in uv space) 
                // float dist = clamp(length(moveDelta) / 0.085, 0.0, 1.0);
                // newAccum *= 1.0 - dist;



                // I think this reprojection shader has a problem, the "old normal" could
                // be different because e.g. the model was rotated, so the pixel might be valid,
                // but a previous rotation could have changed the normal enough so that the test fails


                if(dot(oldNormal, normal) < 0.94) newAccum = 0.0;
                if(abs(oldMeshId - uMeshId) > 0.5) newAccum = 0.0;
                // if(length(oldWorldPosition - vWorldFragPos) > 0.175) newAccum = 0.0;

                gl_FragColor = vec4(moveDelta, newAccum, 1.0);
                // // test that looks beautiful: (try it)
                // // gl_FragColor = vec4(newAccum / 20.0, 0.0, newAccum, 1.0);





                // vec3 oldCameraPos = uOldCameraPos;
                // vec3 p = find_reflection_incident_point(
                //     oldCameraPos, oldIntersectionPoint, oldWorldPosition, oldNormal);
                
                // // note how we're using the view matrix instead of worldView
                // vec4 np = vProjectionMatrix * uOldViewMatrix * vec4(p, 1.0);
                // np.xyzw /= np.w;
                // np.xy = np.xy * 0.5 + 0.5;

                // // if(oldIntersectionPoint == vec3(0.0)) {
                // //     np.xy = ndcOldPos.xy;
                // // }

                // gl_FragColor = vec4(np.xy, newAccum, 1.0);
                // // gl_FragColor = vec4((p - oldWorldPosition) * 100.0, 1.0);
            }`,

            side: THREE.DoubleSide,
        });

        this.renderer = renderer;

        this.momentBufferScene = new THREE.Scene();

        this.scene = scene;
        this.camera = camera;
        this.lastViewMatrixInverse = camera.matrixWorldInverse.clone();
        this.lastCameraPos         = camera.position.clone();
    }

    computeMoment(SSRposition) {
        // this.camera.matrixWorldInverse.clone();
        // if(!this.camera.matrixWorldInverse.equals(this.lastViewMatrixInverse)) {
        //     console.log("matrices are different");
        // }

        this.momentMoveRT.swap();

        let autoClearOpt = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.momentMoveRT.write);
        this.renderer.clear();

        this.momentBufferMaterial.uniforms.uOldCameraPos.value.set(this.lastCameraPos.x, this.lastCameraPos.y, this.lastCameraPos.z);
        this.momentBufferMaterial.uniforms.uLastMomentMove.value = this.momentMoveRT.read.texture;
        this.momentBufferMaterial.uniforms.uSSRPosition.value = SSRposition;

        for(let i = this.scene.children.length - 1; i >= 0; i--) {
            if(!this.scene.children[i] instanceof THREE.Mesh) continue;
            if(!this.scene.children[i].oldWorldMatrix) this.scene.children[i].oldWorldMatrix = this.scene.children[i].matrixWorld.clone();

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
            this.momentBufferMaterial.uniforms.uOldViewMatrix.value = this.lastViewMatrixInverse;
            this.momentBufferMaterial.uniforms.uOldModelViewMatrix.value = viewModelMatrix;
            this.momentBufferMaterial.uniforms.uOldModelViewMatrix.needsUpdate = true;
            this.momentBufferMaterial.uniforms.uMeshId.value = this.scene.children[i].savedMaterial.meshId;
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
        this.lastCameraPos         = this.camera.position.clone();
        for(let i = 0; i < this.scene.children.length; i++) {
            this.scene.children[i].oldWorldMatrix = this.scene.children[i].matrixWorld.clone();
        }
    }
}