@group(0) @binding(0) var<uniform> objects: Objects;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(
  @location(0) position: vec4f,
  @location(1) normal: vec4f,
  @location(2) uv_or_color: vec4f,
) -> GBufferVertexOut {
  var output: GBufferVertexOut;
  output.position = uniforms.view_proj_mat * objects.mat * position;
  output.normal_w = objects.mat * normal;
  output.uv_or_color = uv_or_color;
  output.material_kind = MATERIAL_LAMBERTIAN;
  return output;
}
