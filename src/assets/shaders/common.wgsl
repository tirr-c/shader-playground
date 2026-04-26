struct Objects {
  mat: mat4x4f,
}

struct Uniforms {
  view_mat: mat4x4f,
  view_proj_mat: mat4x4f,
  view_proj_mat_inv: mat4x4f,
}

struct PointLight {
  @align(128)
  pos: vec3f,
  dir_and_half_theta: vec4f,
  color_intensity: vec3f,
  view_proj_mat: mat4x4f,
}

struct GBufferVertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal_w: vec4f,
  @location(1) uv_or_color: vec4f,
}

const MATERIAL_LAMBERTIAN: u32 = 0;
