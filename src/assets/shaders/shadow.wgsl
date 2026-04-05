@group(0) @binding(0) var<uniform> objects: Objects;
@group(1) @binding(0) var<uniform> point_light: PointLight;

@vertex
fn main(
  @location(0) position: vec4f,
) -> @builtin(position) vec4f {
  return point_light.view_proj_mat * objects.mat * position;
}
